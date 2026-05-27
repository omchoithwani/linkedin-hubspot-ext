(() => {
  const url = window.location.href;
  const cleanUrl = url.split('?')[0].replace(/\/$/, '');

  function getText(selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const text = (el.innerText || el.textContent || el.getAttribute('content') || '').trim();
          if (text) return text;
        }
      } catch (_) {}
    }
    return null;
  }

  function isCompanyPage() {
    return /linkedin\.com\/company\//i.test(url);
  }

  function isContactPage() {
    return /linkedin\.com\/in\//i.test(url);
  }

  function scrapeCompany() {
    const name = getText([
      'h1.org-top-card-summary__title',
      'h1[class*="org-top-card"]',
      'h1',
      'meta[property="og:title"]'
    ]);
    console.log('[LI→HS] company name:', name);

    // Website: look in the about section for external links
    let website = null;
    const aboutLinks = document.querySelectorAll(
      'a[data-field="website"], ' +
      '.org-about-company-module__website a, ' +
      'a[href*="://"][data-tracking-control-name*="about_website"], ' +
      '.link-without-visited-state[target="_blank"]'
    );
    for (const link of aboutLinks) {
      const href = link.getAttribute('href') || '';
      if (href && !href.includes('linkedin.com') && href.startsWith('http')) {
        website = href.split('?')[0];
        break;
      }
    }

    // Fallback: scan all external links in about section
    if (!website) {
      const section = document.querySelector(
        '.org-about-us-organization-description, .org-page-details-module, section[data-member-id]'
      );
      if (section) {
        const links = section.querySelectorAll('a[href^="http"]');
        for (const link of links) {
          const href = link.getAttribute('href') || '';
          if (!href.includes('linkedin.com')) {
            website = href.split('?')[0];
            break;
          }
        }
      }
    }

    // Broader fallback: any external link that looks like a company website
    if (!website) {
      const allLinks = document.querySelectorAll('a[href^="http"]');
      for (const link of allLinks) {
        const href = link.getAttribute('href') || '';
        if (
          !href.includes('linkedin.com') &&
          !href.includes('google.com') &&
          !href.includes('facebook.com') &&
          !href.includes('twitter.com') &&
          link.closest('[class*="about"]')
        ) {
          website = href.split('?')[0];
          break;
        }
      }
    }

    console.log('[LI→HS] website:', website);

    return {
      mode: 'company',
      name: name || null,
      linkedinUrl: cleanUrl,
      website: website || null
    };
  }

  function scrapeContact() {
    // Full name from h1
    const fullName = getText([
      'h1.text-heading-xlarge',
      'h1[class*="text-heading"]',
      '.pv-top-card--list .text-heading-xlarge',
      'h1'
    ]);
    console.log('[LI→HS] full name:', fullName);

    let firstName = null;
    let lastName = null;
    if (fullName) {
      const parts = fullName.trim().split(/\s+/);
      firstName = parts[0] || null;
      lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;
    }

    // Email: only from contact info modal if already open / visible
    let email = null;
    const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
    for (const link of mailtoLinks) {
      const addr = link.getAttribute('href').replace('mailto:', '').split('?')[0].trim();
      if (addr && addr.includes('@')) {
        email = addr;
        break;
      }
    }
    console.log('[LI→HS] email:', email);

    // Current company: first experience entry
    let company = null;
    const expSelectors = [
      // Newer LinkedIn layout
      '#experience ~ .pvs-list__outer-container .pvs-list__item--line-separated:first-child .t-14.t-normal.t-black',
      '#experience + * .pvs-list__item--line-separated:first-child span[aria-hidden="true"]',
      // Experience section company name
      '.pv-entity__secondary-title.pv-entity__company-summary-info',
      '.pv-profile-section__card-item:first-child .pv-entity__secondary-title',
      // Fallback: top card current company
      '.pv-top-card--experience-list-item .pv-entity__secondary-title',
      '.inline-show-more-text--is-collapsed span[aria-hidden="true"]'
    ];

    for (const sel of expSelectors) {
      try {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const text = (el.innerText || el.textContent || '').trim();
          // Skip titles that are position names — look for company-like text
          if (text && text.length < 100 && !text.includes('\n')) {
            company = text;
            break;
          }
        }
        if (company) break;
      } catch (_) {}
    }

    // Fallback: look for experience section structure
    if (!company) {
      try {
        const expSection = document.querySelector('#experience');
        if (expSection) {
          // Walk siblings to find the list
          let sibling = expSection.nextElementSibling;
          while (sibling && !company) {
            const items = sibling.querySelectorAll('li');
            if (items.length > 0) {
              const firstItem = items[0];
              // Company name is usually the second span[aria-hidden] in the item
              const spans = firstItem.querySelectorAll('span[aria-hidden="true"]');
              for (let i = 1; i < spans.length; i++) {
                const txt = spans[i].textContent.trim();
                if (txt && !txt.includes('·') && txt.length > 1) {
                  company = txt;
                  break;
                }
              }
            }
            sibling = sibling.nextElementSibling;
          }
        }
      } catch (_) {}
    }

    // Last fallback: subtitle under name on top card
    if (!company) {
      const subtitle = getText([
        '.pv-top-card--experience-list .pv-entity__secondary-title',
        '.top-card-layout__headline',
        '.text-body-medium.break-words'
      ]);
      // These usually say "Title at Company" — try to extract company after " at "
      if (subtitle && subtitle.includes(' at ')) {
        company = subtitle.split(' at ').pop().trim();
      }
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

  if (isCompanyPage()) return scrapeCompany();
  if (isContactPage()) return scrapeContact();
  return { mode: 'unknown' };
})();
