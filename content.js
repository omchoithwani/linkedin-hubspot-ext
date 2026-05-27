// Returns a Promise; chrome.scripting.executeScript awaits it automatically.
(async () => {
  const url = window.location.href;
  const cleanUrl = url.split('?')[0].replace(/\/$/, '');

  const isCompany = /linkedin\.com\/company\//i.test(url);
  const isContact = /linkedin\.com\/in\//i.test(url);

  // ── helpers ──────────────────────────────────────────────────────────────

  // Wait until selector exists AND has non-empty text, or timeout.
  function waitFor(selector, ms = 6000) {
    return new Promise(resolve => {
      function check() {
        try {
          const el = document.querySelector(selector);
          if (el && (el.innerText || el.textContent || '').trim()) return resolve(el);
        } catch (_) {}
        return null;
      }
      if (check()) return;
      const start = Date.now();
      const id = setInterval(() => {
        if (check()) { clearInterval(id); return; }
        if (Date.now() - start >= ms) { clearInterval(id); resolve(null); }
      }, 200);
    });
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function nodeText(el) {
    if (!el) return null;
    const t = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    return t || null;
  }

  // Return first non-empty text from any selector.
  function firstText(...selectors) {
    for (const sel of selectors) {
      try {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const t = nodeText(el);
          if (t) return t;
        }
      } catch (_) {}
    }
    return null;
  }

  function metaContent(selector) {
    try {
      const el = document.querySelector(selector);
      return el ? (el.getAttribute('content') || '').trim() || null : null;
    } catch (_) { return null; }
  }

  // ── contact ───────────────────────────────────────────────────────────────

  async function scrapeContact() {
    // Wait for h1 with text, then give React another 600ms to hydrate everything
    await waitFor('h1', 7000);
    await sleep(600);

    // ── Name ──
    // Broad selector set so we catch any LinkedIn UI variant
    let fullName = firstText(
      'h1.text-heading-xlarge',
      'h1[class*="text-heading"]',
      'h1[class*="heading"]',
      '.pv-top-card h1',
      '.profile-topcard-person-entity__name',
      'main h1',
      'h1'
    );

    // Fallback: document.title  →  "First Last - Title | LinkedIn"
    if (!fullName && document.title) {
      const m = document.title.match(/^([^|\-]+?)(?:\s*[-–|])/);
      if (m) fullName = m[1].trim();
    }

    // Fallback: og:title  →  "First Last | Title at Company | LinkedIn"
    if (!fullName) {
      const og = metaContent('meta[property="og:title"]');
      if (og) {
        const m = og.match(/^([^|]+)/);
        if (m) fullName = m[1].trim();
      }
    }

    console.log('[LI→HS] fullName:', fullName);

    let firstName = null, lastName = null;
    if (fullName) {
      const parts = fullName.trim().split(/\s+/);
      firstName = parts[0] || null;
      lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;
    }

    // ── Email ──
    let email = null;
    for (const a of document.querySelectorAll('a[href^="mailto:"]')) {
      const addr = (a.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0].trim();
      if (addr.includes('@')) { email = addr; break; }
    }

    // ── Company ──
    let company = null;

    // Strategy 1: walk the #experience section → first list item → span texts
    try {
      const anchor = document.querySelector('#experience');
      if (anchor) {
        // The anchor lives inside a heading div; its parent/grandparent holds the list
        let node = anchor.parentElement;
        for (let i = 0; i < 6 && node; i++) {
          const li = node.querySelector(
            'li.pvs-list__item--line-separated, li.pvs-list__item--no-padding-in-columns, li[class*="pvs-list"]'
          );
          if (li) {
            const spans = [...li.querySelectorAll('span[aria-hidden="true"]')]
              .map(s => s.textContent.trim())
              .filter(Boolean);

            for (let j = 0; j < spans.length; j++) {
              const t = spans[j];
              // Skip date ranges and durations
              if (/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(t)) continue;
              if (/^\d+\s+(yr|mo|yr|mos)/.test(t)) continue;
              if (t.length < 2) continue;
              if (t.includes(' · ')) { company = t.split(' · ')[0].trim(); break; }
              if (j > 0) { company = t; break; }   // first span is always the job title
            }
            break;
          }
          node = node.parentElement;
        }
      }
    } catch (_) {}

    // Strategy 2: headline under name  →  "Title at Company"
    if (!company) {
      const headline = firstText(
        '.text-body-medium.break-words',
        '.ph5 .text-body-medium',
        '.top-card-layout__headline',
        '.pv-top-card--experience-list .pv-entity__secondary-title'
      );
      if (headline) {
        const m = headline.match(/\bat\s+(.+?)(?:\s*[·|•]\s*.*)?$/i);
        if (m) company = m[1].trim();
        else if (headline.includes(' at ')) company = headline.split(' at ').pop().trim();
      }
      console.log('[LI→HS] headline:', headline, '→ company:', company);
    }

    // Strategy 3: og:title  →  "Name | Title at Company | LinkedIn"
    if (!company) {
      const og = metaContent('meta[property="og:title"]');
      if (og) {
        const m = og.match(/\bat\s+([^|]+)/i);
        if (m) company = m[1].trim();
      }
    }

    // Strategy 4: meta description
    if (!company) {
      const desc = metaContent('meta[name="description"], meta[property="og:description"]');
      if (desc) {
        const m = desc.match(/\bat\s+([^.,|]+)/i);
        if (m) company = m[1].trim();
      }
    }

    console.log('[LI→HS] company:', company);
    console.log('[LI→HS] email:', email);

    return {
      mode: 'contact',
      firstName: firstName || null,
      lastName: lastName || null,
      linkedinUrl: cleanUrl,
      email: email || null,
      company: company || null
    };
  }

  // ── company ───────────────────────────────────────────────────────────────

  async function scrapeCompany() {
    await waitFor('h1', 5000);
    await sleep(300);

    const name = firstText(
      'h1.org-top-card-summary__title',
      '.org-top-card-summary__title',
      'h1[class*="org-top-card"]',
      'h1[class*="org"]',
      'main h1',
      'h1'
    );

    let website = null;

    // Priority 1: explicit data attributes / known classes
    for (const a of document.querySelectorAll(
      'a[data-field="website"], ' +
      '.org-about-company-module__website a, ' +
      'a[data-tracking-control-name*="website"], ' +
      '.org-page-details__definition-text a[href^="http"]'
    )) {
      const href = (a.getAttribute('href') || '').split('?')[0];
      if (href.startsWith('http') && !href.includes('linkedin.com')) { website = href; break; }
    }

    // Priority 2: dt "Website" → dd
    if (!website) {
      for (const dt of document.querySelectorAll('dt')) {
        if (/^website$/i.test((dt.innerText || dt.textContent || '').trim())) {
          const dd = dt.nextElementSibling;
          if (dd) {
            const a = dd.querySelector('a[href^="http"]');
            if (a) {
              const href = (a.getAttribute('href') || '').split('?')[0];
              if (!href.includes('linkedin.com')) { website = href; break; }
            }
            const txt = nodeText(dd);
            if (txt && /^https?:\/\//.test(txt)) { website = txt; break; }
          }
        }
      }
    }

    // Priority 3: any external link inside an "about" container
    if (!website) {
      for (const a of document.querySelectorAll('a[href^="http"]')) {
        const href = (a.getAttribute('href') || '').split('?')[0];
        if (!href.includes('linkedin.com') && a.closest('[class*="about"],[id*="about"]')) {
          website = href; break;
        }
      }
    }

    console.log('[LI→HS] name:', name, 'website:', website);

    return { mode: 'company', name: name || null, linkedinUrl: cleanUrl, website: website || null };
  }

  // ── dispatch ──────────────────────────────────────────────────────────────

  if (isCompany) return scrapeCompany();
  if (isContact) return scrapeContact();
  return { mode: 'unknown' };
})();
