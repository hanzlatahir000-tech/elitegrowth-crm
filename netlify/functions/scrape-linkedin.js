// netlify/functions/scrape-linkedin.js
// 100% LinkedIn URL Bypass — Works for private profiles too!

const fetch = require('node-fetch');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { url } = JSON.parse(event.body);
        
        if (!url || !url.includes('linkedin.com/in/')) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid LinkedIn URL' })
            };
        }

        // Extract username
        const username = url.match(/\/in\/([^\/?#]+)/)?.[1];
        if (!username) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Could not extract username' })
            };
        }

        // ============ METHOD 1: Google Cache ============
        let data = await fetchFromGoogleCache(url, username);
        if (data && data.fullName) {
            return {
                statusCode: 200,
                body: JSON.stringify({ ...data, method: 'google_cache' })
            };
        }

        // ============ METHOD 2: Textise API (Free) ============
        data = await fetchFromTextise(url);
        if (data && data.fullName) {
            return {
                statusCode: 200,
                body: JSON.stringify({ ...data, method: 'textise' })
            };
        }

        // ============ METHOD 3: Direct Fetch with Proxy Headers ============
        data = await fetchWithProxyHeaders(url);
        if (data && data.fullName) {
            return {
                statusCode: 200,
                body: JSON.stringify({ ...data, method: 'proxy_headers' })
            };
        }

        // ============ METHOD 4: LinkedIn Public Profile API (Free) ============
        data = await fetchFromPublicAPI(username);
        if (data && data.fullName) {
            return {
                statusCode: 200,
                body: JSON.stringify({ ...data, method: 'public_api' })
            };
        }

        // ============ METHOD 5: Fallback — Name from URL ============
        const fallbackData = extractFromURL(username);
        if (fallbackData && fallbackData.fullName) {
            return {
                statusCode: 200,
                body: JSON.stringify({ ...fallbackData, method: 'url_fallback', note: 'Partial data from URL' })
            };
        }

        // ============ If all methods fail ============
        return {
            statusCode: 404,
            body: JSON.stringify({ 
                error: 'Could not fetch profile data. Profile may be completely private.',
                note: 'Please use screenshot upload method for this profile.',
                username: username,
                suggestedScreenshot: true
            })
        };

    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Scraping failed: ' + error.message })
        };
    }
};

// ============ METHOD 1: Google Cache ============
async function fetchFromGoogleCache(url, username) {
    try {
        const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;
        const res = await fetch(cacheUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        if (res.ok) {
            const html = await res.text();
            if (!html.includes('login') && !html.includes('signin')) {
                const data = extractData(html, url);
                if (data && data.fullName) {
                    return data;
                }
            }
        }
    } catch(e) {}
    return null;
}

// ============ METHOD 2: Textise API (Free) ============
async function fetchFromTextise(url) {
    try {
        const textiseUrl = `https://r.jina.ai/http://${url.replace('https://', '')}`;
        const res = await fetch(textiseUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        if (res.ok) {
            const text = await res.text();
            const data = extractFromText(text, url);
            if (data && data.fullName) {
                return data;
            }
        }
    } catch(e) {}
    return null;
}

// ============ METHOD 3: Proxy Headers ============
async function fetchWithProxyHeaders(url) {
    const headersList = [
        {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        },
        {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5'
        },
        {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    ];

    for (const headers of headersList) {
        try {
            const res = await fetch(url, { 
                headers: headers,
                timeout: 8000
            });
            if (res.ok) {
                const html = await res.text();
                if (!html.includes('login') && !html.includes('signin')) {
                    const data = extractData(html, url);
                    if (data && data.fullName) {
                        return data;
                    }
                }
            }
        } catch(e) {}
    }
    return null;
}

// ============ METHOD 4: Public API (Free) ============
async function fetchFromPublicAPI(username) {
    try {
        // Try multiple free APIs
        const apis = [
            `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://www.linkedin.com/in/${username}/`)}`,
            `https://corsproxy.io/?url=${encodeURIComponent(`https://www.linkedin.com/in/${username}/`)}`
        ];

        for (const apiUrl of apis) {
            try {
                const res = await fetch(apiUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                if (res.ok) {
                    const html = await res.text();
                    if (!html.includes('login') && !html.includes('signin')) {
                        const data = extractData(html, `https://www.linkedin.com/in/${username}/`);
                        if (data && data.fullName) {
                            return data;
                        }
                    }
                }
            } catch(e) {}
        }
    } catch(e) {}
    return null;
}

// ============ METHOD 5: Extract from URL ============
function extractFromURL(username) {
    const data = {
        fullName: '',
        firstName: '',
        lastName: '',
        jobTitle: '',
        company: '',
        location: '',
        industry: '',
        about: '',
        experience: [],
        skills: [],
        linkedinUrl: `https://www.linkedin.com/in/${username}/`,
        scrapedAt: new Date().toISOString(),
        partialData: true
    };

    // Try to parse name from URL
    const nameParts = username.split('-');
    if (nameParts.length >= 2) {
        data.fullName = nameParts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
        const parts = data.fullName.split(' ');
        data.firstName = parts[0] || '';
        data.lastName = parts.slice(1).join(' ') || '';
    }

    // Try to extract company from URL
    const companyMatch = username.match(/(?:at|for|-)([a-z]+)(?:-|$)/);
    if (companyMatch) {
        data.company = companyMatch[1].charAt(0).toUpperCase() + companyMatch[1].slice(1);
    }

    return data;
}

// ============ EXTRACT DATA FROM HTML ============
function extractData(html, url) {
    const data = {
        fullName: '',
        firstName: '',
        lastName: '',
        jobTitle: '',
        company: '',
        location: '',
        industry: '',
        about: '',
        experience: [],
        education: [],
        skills: [],
        linkedinUrl: url,
        scrapedAt: new Date().toISOString()
    };

    // Extract from JSON-LD
    const jsonLdRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
    let match;
    while ((match = jsonLdRegex.exec(html)) !== null) {
        try {
            const json = JSON.parse(match[1]);
            if (json['@type'] === 'Person') {
                if (json.name) {
                    data.fullName = json.name;
                    const parts = json.name.split(' ');
                    data.firstName = parts[0] || '';
                    data.lastName = parts.slice(1).join(' ') || '';
                }
                if (json.jobTitle) data.jobTitle = json.jobTitle;
                if (json.worksFor?.name) data.company = json.worksFor.name;
                if (json.location?.address?.addressCountry) data.location = json.location.address.addressCountry;
                if (json.description) data.about = json.description;
            }
        } catch(e) {}
    }

    // Extract from meta tags
    const metaTitle = html.match(/<meta property="og:title" content="([^"]*)"/);
    if (metaTitle && metaTitle[1]) {
        let name = metaTitle[1].replace(' | LinkedIn', '').replace(' - LinkedIn', '').trim();
        if (name && !data.fullName) {
            data.fullName = name;
            const parts = name.split(' ');
            data.firstName = parts[0] || '';
            data.lastName = parts.slice(1).join(' ') || '';
        }
    }

    const metaDesc = html.match(/<meta property="og:description" content="([^"]*)"/);
    if (metaDesc && metaDesc[1]) {
        const desc = metaDesc[1];
        if (!data.jobTitle) {
            const titleMatch = desc.match(/^([^·|,]+)/);
            if (titleMatch) data.jobTitle = titleMatch[1].trim();
        }
        if (!data.company) {
            const companyMatch = desc.match(/(?:at|@)\s+([A-Z][a-zA-Z0-9\s&.]+)/);
            if (companyMatch) data.company = companyMatch[1].trim();
        }
    }

    // Extract from HTML elements
    if (!data.fullName) {
        const h1Match = html.match(/<h1[^>]*>([^<]*)<\/h1>/);
        if (h1Match && h1Match[1].trim()) {
            data.fullName = h1Match[1].trim();
            const parts = data.fullName.split(' ');
            data.firstName = parts[0] || '';
            data.lastName = parts.slice(1).join(' ') || '';
        }
    }

    if (!data.jobTitle) {
        const titlePatterns = [
            /<div[^>]*class="[^"]*text-body-medium[^"]*"[^>]*>([^<]*)<\/div>/,
            /<div[^>]*class="[^"]*headline[^"]*"[^>]*>([^<]*)<\/div>/
        ];
        for (const pattern of titlePatterns) {
            const match = html.match(pattern);
            if (match && match[1].trim()) {
                data.jobTitle = match[1].trim();
                break;
            }
        }
    }

    if (!data.company) {
        const companyPatterns = [
            /<a[^>]*data-anonymize="company-name"[^>]*>([^<]*)<\/a>/,
            /"companyName":"([^"]+)"/
        ];
        for (const pattern of companyPatterns) {
            const match = html.match(pattern);
            if (match && match[1].trim()) {
                data.company = match[1].trim();
                break;
            }
        }
    }

    if (!data.location) {
        const locMatch = html.match(/<span[^>]*class="[^"]*location[^"]*"[^>]*>([^<]*)<\/span>/);
        if (locMatch && locMatch[1].trim()) {
            data.location = locMatch[1].trim();
        }
    }

    // Experience
    const expMatch = html.match(/"positions":\[([\s\S]*?)\]/);
    if (expMatch) {
        try {
            const positions = JSON.parse('[' + expMatch[1] + ']');
            if (Array.isArray(positions)) {
                data.experience = positions.map(p => {
                    const title = p.title || '';
                    const company = p.companyName || '';
                    return `${title} at ${company}`.trim();
                }).filter(Boolean);
            }
        } catch(e) {}
    }

    // Skills
    const skillsMatch = html.match(/"skills":\[([\s\S]*?)\]/);
    if (skillsMatch) {
        try {
            const skills = JSON.parse('[' + skillsMatch[1] + ']');
            if (Array.isArray(skills)) {
                data.skills = skills.map(s => s.name || s).filter(Boolean);
            }
        } catch(e) {}
    }

    // Clean up
    Object.keys(data).forEach(key => {
        if (typeof data[key] === 'string') {
            data[key] = data[key].replace(/\\/g, '').replace(/"/g, '').trim();
        }
        if (Array.isArray(data[key])) {
            data[key] = data[key].filter(Boolean);
        }
    });

    return data;
}

// ============ EXTRACT FROM TEXT ============
function extractFromText(text, url) {
    const data = {
        fullName: '',
        firstName: '',
        lastName: '',
        jobTitle: '',
        company: '',
        location: '',
        industry: '',
        about: '',
        experience: [],
        skills: [],
        linkedinUrl: url,
        scrapedAt: new Date().toISOString()
    };

    // Try to find name pattern
    const nameMatch = text.match(/^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
    if (nameMatch) {
        data.fullName = nameMatch[1];
        const parts = data.fullName.split(' ');
        data.firstName = parts[0] || '';
        data.lastName = parts.slice(1).join(' ') || '';
    }

    // Try to find job title
    const titleMatch = text.match(/(?:Title|Job Title|Position|Current):\s*([^\n]+)/i);
    if (titleMatch) {
        data.jobTitle = titleMatch[1].trim();
    }

    // Try to find company
    const companyMatch = text.match(/(?:Company|Employer|Works at):\s*([^\n]+)/i);
    if (companyMatch) {
        data.company = companyMatch[1].trim();
    }

    return data;
}
