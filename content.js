// Runs as an async IIFE so chrome.scripting.executeScript awaits the Promise.
(async () => {
  const url = window.location.href;
  const cleanUrl = url.split('?')[0].replace(/\/$/, '');

  // ── Utilities ──────────────────────────────────────────────────────────────

  // Poll for a selector up to `timeout` ms, resolve with element or null.
  function waitFor(selector, timeout = 5000) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const start = Date.now();
      const timer = setInterval(() => {
        const found = document.querySelector(selector);
        if (found) { clearInterval(timer); return resolve(found); }
        if (Date.now() - start >= timeout) { clearInterval(timer); resolve(null); }
      }, 150);
    });
  }

  function nodeText(el) {
    if (!el) return null;
    return (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ') || null;
  }

  function firstMatch(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        const t = nodeText(el);
        if (t) return t;
      } catch (_) {}
    }
    return null;
  }

  // ── Mode detection ─────────────────────────────────────────────────────────

  const isCompany = /linkedin\.com\/company\//i.test(url);
  const isContact = /linkedin\.com\/in\//i.test(url);

  // ── Company scraper ────────────────────────────────────────────────────────

  async function scrapeCompany() {
    // Wait until the page title renders
    await waitFor('h1');

    const name = firstMatch([
      'h1.org-top-card-summary__title',
      '.org-top-card-summary__title',
      'h1[class*="org-top-card"]',
      'h1'
    ]);
    console.log('[LI→HS] name:', name);

    // ── Website ──
    // LinkedIn company pages render website in the About section.
    // Selector priorities: data attribute → known class → any external link near "about" content.
    let website = null;

    const websiteCandidates = [
      ...document.querySelectorAll(
        'a[data-field="website"], ' +
        '.org-about-company-module__website a, ' +
        'a[data-tracking-control-name*="website"], ' +
        '.org-page-details__definition-text a[href^="http"]'
      )
    ];

    for (const a of websiteCandidates) {
      const href = (a.getAttribute('href') || '').split('?')[0];
      if (href.startsWith('http') && !href.includes('linkedin.com')) {
        website = href;
        break;
      }
    }

    // Fallback: any external <a> whose ancestor has "about" in its class/id
    if (!website) {
      for (const a of document.querySelectorAll('a[href^="http"]')) {
        const href = (a.getAttribute('href') || '').split('?')[0];
        if (!href.includes('linkedin.com') && a.closest('[class*="about"],[id*="about"]')) {
          website = href;
          break;
        }
      }
    }

    // Fallback: <dd> elements that contain a plain URL text (About tab layout)
    if (!website) {
      for (const dd of document.querySelectorAll('dd')) {
        const t = nodeText(dd);
        if (t && /^https?:\/\//.test(t)) { website = t; break; }
        // Or a child anchor
        const a = dd.querySelector('a[href^="http"]');
        if (a) {
          const href = (a.getAttribute('href') || '').split('?')[0];
          if (!href.includes('linkedin.com')) { website = href; break; }
        }
      }
    }

    console.log('[LI→HS] website:', website);

    return { mode: 'company', name: name || null, linkedinUrl: cleanUrl, website: website || null };
  }

  // ── Contact scraper ────────────────────────────────────────────────────────

  async function scrapeContact() {
    // Wait for the name heading — signals the profile has rendered
    await waitFor('h1.text-heading-xlarge, h1[class*="text-heading"], h1', 6000);

    // ── Name ──
    const fullName = firstMatch([
      'h1.text-heading-xlarge',
      'h1[class*="text-heading"]',
      'h1'
    ]);
    console.log('[LI→HS] fullName:', fullName);

    let firstName = null, lastName = null;
    if (fullName) {
      const parts = fullName.trim().split(/\s+/);
      firstName = parts[0] || null;
      lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;
    }

    // ── Email (only if a mailto: link is already visible) ──
    let email = null;
    for (const a of document.querySelectorAll('a[href^="mailto:"]')) {
      const addr = a.getAttribute('href').replace(/^mailto:/i, '').split('?')[0].trim();
      if (addr.includes('@')) { email = addr; break; }
    }
    console.log('[LI→HS] email:', email);

    // ── Current company ──
    // Strategy 1: experience section — find the #experience anchor, then walk
    // its nearest parent section/div to find the first list item.
    let company = null;

    const expAnchor = document.querySelector('#experience');
    if (expAnchor) {
      // The anchor is usually inside or just before the section container.
      // Walk up to find a container that holds a <ul> or <li> list.
      let container = expAnchor.parentElement;
      for (let i = 0; i < 5 && container && !container.querySelector('li'); i++) {
        container = container.parentElement;
      }

      const firstLi = container && container.querySelector('li');
      if (firstLi) {
        // Each list item has several span[aria-hidden="true"]:
        //   [0] = job title
        //   [1] = company name (may include " · Full-time" etc.)
        //   [2] = date range
        //   [3] = duration
        // For a grouped entry (multiple roles at same company) the order differs.
        const spans = [...firstLi.querySelectorAll('span[aria-hidden="true"]')]
          .map(s => s.textContent.trim())
          .filter(t => t.length > 0);

        // Find the first span that looks like a company (not a date/duration/title)
        // Company spans often contain " · " (e.g. "Acme Corp · Full-time")
        // or are simply a company name on its own.
        for (let i = 0; i < spans.length; i++) {
          const t = spans[i];
          // Skip if it's clearly a date range
          if (/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b.*\d{4}/.test(t)) continue;
          // Skip very short tokens (month names, years on their own)
          if (t.length < 2) continue;
          // Skip duration strings like "2 yrs 3 mos"
          if (/^\d+\s+(yr|mo)/.test(t)) continue;

          // If it has a bullet separator, take what's before " · "
          if (t.includes(' · ')) {
            company = t.split(' · ')[0].trim();
            break;
          }
          // Otherwise use it directly — but only if index > 0 (skip the title at [0])
          if (i > 0) {
            company = t;
            break;
          }
        }
      }
    }

    // Strategy 2: headline text — "Title at Company"
    if (!company) {
      const headline = firstMatch([
        '.text-body-medium.break-words',
        '.top-card-layout__headline',
        '.pv-top-card--experience-list .pv-entity__secondary-title'
      ]);
      if (headline) {
        // "Senior Engineer at Acme" → "Acme"
        // "Senior Engineer at Acme · Full-time" → "Acme"
        const atMatch = headline.match(/\bat\s+(.+?)(?:\s*[·|]\s*.*)?$/i);
        if (atMatch) company = atMatch[1].trim();
      }
      console.log('[LI→HS] headline fallback:', headline, '→ company:', company);
    }

    // Strategy 3: top-card experience pills
    if (!company) {
      const pill = firstMatch([
        '.pv-top-card--experience-list-item span[aria-hidden="true"]',
        '.pv-top-card-v2-ctas .pv-entity__secondary-title'
      ]);
      if (pill) company = pill;
    }

    console.log('[LI→HS] company:', company);

    return {
      mode: 'contact',
      firstName: firstName || null,
      lastName: lastName || null,
      linkedinUrl: cleanUrl,
      email: email || null,
      company: company || null
    };
  }

  // ── Dispatch ───────────────────────────────────────────────────────────────

  if (isCompany) return scrapeCompany();
  if (isContact) return scrapeContact();
  return { mode: 'unknown' };
})();
