// netlify/functions/scrape-linkedin.js
// 100% FREE — No API keys needed!

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

        // Method 1: Try direct fetch (might work for public profiles)
        let html = await fetchWithRetry(url);
        
        // Method 2: If blocked, try alternative approach
        if (!html || html.includes('login') || html.includes('signin')) {
            html = await fetchWithAlternativeHeaders(url);
        }
        
        // Method 3: Last resort — use public cached version
        if (!html || html.includes('login')) {
            const cached = await fetchFromCache(url);
            if (cached) {
                return {
                    statusCode: 200,
                    body: JSON.stringify(cached)
                };
            }
        }

        if (!html || html.includes('login') || html.includes('signin')) {
            return {
                statusCode: 403,
                body: JSON.stringify({ 
                    error: 'Profile is private. Use screenshot upload method instead.',
                    note: 'Screenshot method always works!'
                })
            };
        }

        const data = extractData(html, url);
        return {
            statusCode: 200,
            body: JSON.stringify(data)
        };

    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Scraping failed: ' + error.message })
        };
    }
};

async function fetchWithRetry(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });
            if (res.ok) {
                const text = await res.text();
                if (!text.includes('login') && !text.includes('signin')) {
                    return text;
                }
            }
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        } catch(e) {}
    }
    return null;
}

async function fetchWithAlternativeHeaders(url) {
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1'
            }
        });
        if (res.ok) {
            const text = await res.text();
            if (!text.includes('login') && !text.includes('signin')) {
                return text;
            }
        }
    } catch(e) {}
    return null;
}

async function fetchFromCache(url) {
    // Try to extract username from URL
    const username = url.match(/\/in\/([^\/?#]+)/)?.[1];
    if (!username) return null;
    
    // Try Google's cached version
    try {
        const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;
        const res = await fetch(cacheUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        if (res.ok) {
            const html = await res.text();
            if (!html.includes('login')) {
                const data = extractData(html, url);
                data.fromCache = true;
                return data;
            }
        }
    } catch(e) {}
    return null;
}

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
        skills: [],
        linkedinUrl: url,
        scrapedAt: new Date().toISOString(),
        fromCache: false
    };

    // Extract Name from <title>
    const titleMatch = html.match(/<title>(.*?)<\/title>/);
    if (titleMatch) {
        let name = titleMatch[1].replace(' | LinkedIn', '').replace(' - LinkedIn', '').trim();
        if (name) {
            data.fullName = name;
            const parts = name.split(' ');
            data.firstName = parts[0] || '';
            data.lastName = parts.slice(1).join(' ') || '';
        }
    }

    // Extract from JSON-LD
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
    if (jsonLdMatch) {
        try {
            const jsonData = JSON.parse(jsonLdMatch[1]);
            if (jsonData.name) data.fullName = jsonData.name;
            if (jsonData.jobTitle) data.jobTitle = jsonData.jobTitle;
            if (jsonData.worksFor?.name) data.company = jsonData.worksFor.name;
            if (jsonData.location?.address?.addressCountry) data.location = jsonData.location.address.addressCountry;
        } catch(e) {}
    }

    // Extract from meta tags
    const metaTitle = html.match(/<meta property="og:title" content="(.*?)"/);
    if (metaTitle) {
        let name = metaTitle[1].replace(' | LinkedIn', '').trim();
        if (name && !data.fullName) {
            data.fullName = name;
            const parts = name.split(' ');
            data.firstName = parts[0] || '';
            data.lastName = parts.slice(1).join(' ') || '';
        }
    }

    // Extract headline from meta description
    const metaDesc = html.match(/<meta property="og:description" content="(.*?)"/);
    if (metaDesc) {
        const desc = metaDesc[1];
        if (desc && !data.jobTitle) {
            // Try to extract job title from description
            const titleMatch2 = desc.match(/^(.+?)(?: at | - | \| |,)/);
            if (titleMatch2) {
                data.jobTitle = titleMatch2[1].trim();
            }
        }
    }

    // Extract company from various patterns
    if (!data.company) {
        const companyPatterns = [
            /"companyName":"(.*?)"/,
            /"worksFor":.*?"name":"(.*?)"/,
            /at\s+([A-Z][a-zA-Z0-9\s\.&]+?)(?:\s*[,\|]|\s*$)/,
            /<a[^>]*data-field="company"[^>]*>(.*?)<\/a>/
        ];
        for (const pattern of companyPatterns) {
            const match = html.match(pattern);
            if (match) {
                data.company = match[1].trim();
                break;
            }
        }
    }

    // Extract location
    if (!data.location) {
        const locationPatterns = [
            /"address":.*?"addressCountry":"(.*?)"/,
            /"location":.*?"name":"(.*?)"/,
            /<span[^>]*class="[^"]*location[^"]*"[^>]*>(.*?)<\/span>/
        ];
        for (const pattern of locationPatterns) {
            const match = html.match(pattern);
            if (match) {
                data.location = match[1].trim();
                break;
            }
        }
    }

    // Extract about
    const aboutMatch = html.match(/"summary":"(.*?)"/);
    if (aboutMatch) {
        data.about = aboutMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
    }

    // Extract experience
    const expMatch = html.match(/"positions":\[(.*?)\]/s);
    if (expMatch) {
        try {
            const positions = JSON.parse('[' + expMatch[1] + ']');
            if (Array.isArray(positions)) {
                data.experience = positions.map(p => {
                    return `${p.title || ''} at ${p.companyName || ''}`;
                }).filter(Boolean);
            }
        } catch(e) {}
    }

    // Extract skills
    const skillsMatch = html.match(/"skills":\[(.*?)\]/s);
    if (skillsMatch) {
        try {
            const skills = JSON.parse('[' + skillsMatch[1] + ']');
            if (Array.isArray(skills)) {
                data.skills = skills.map(s => s.name || s).filter(Boolean);
            }
        } catch(e) {}
    }

    // Fallback: Try to extract from visible text
    if (!data.fullName) {
        const nameMatch = html.match(/<h1[^>]*class="[^"]*"[^>]*>(.*?)<\/h1>/);
        if (nameMatch) {
            data.fullName = nameMatch[1].trim();
            const parts = data.fullName.split(' ');
            data.firstName = parts[0] || '';
            data.lastName = parts.slice(1).join(' ') || '';
        }
    }

    if (!data.jobTitle) {
        const titleMatch3 = html.match(/<div[^>]*class="[^"]*headline[^"]*"[^>]*>(.*?)<\/div>/);
        if (titleMatch3) {
            data.jobTitle = titleMatch3[1].trim();
        }
    }

    // Clean up
    Object.keys(data).forEach(key => {
        if (typeof data[key] === 'string') {
            data[key] = data[key].replace(/\\/g, '').replace(/"/g, '').trim();
        }
    });

    return data;
}
