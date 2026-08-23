// netlify/functions/scrape-linkedin.js
// IMPROVED VERSION — Better LinkedIn data extraction

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
                body: JSON.stringify({ error: 'Invalid LinkedIn URL. Must be linkedin.com/in/...' })
            };
        }

        // Fetch with multiple strategies
        let html = await fetchWithStrategy(url);
        
        if (!html || html.includes('login') || html.includes('signin')) {
            return {
                statusCode: 403,
                body: JSON.stringify({ 
                    error: 'Profile is private. Please use screenshot upload method.',
                    note: 'Screenshot method always works!'
                })
            };
        }

        const data = extractLinkedInData(html, url);
        
        // Check if we got meaningful data
        if (!data.fullName && !data.jobTitle && !data.company) {
            return {
                statusCode: 404,
                body: JSON.stringify({ 
                    error: 'Could not extract profile data. Try screenshot method.',
                    data: data
                })
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify(data)
        };

    } catch (error) {
        console.error('Scraping error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Scraping failed: ' + error.message })
        };
    }
};

async function fetchWithStrategy(url) {
    const strategies = [
        // Strategy 1: Standard browser
        {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1'
            }
        },
        // Strategy 2: Mobile
        {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        },
        // Strategy 3: Old browser
        {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:40.0) Gecko/20100101 Firefox/40.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        }
    ];

    for (const strategy of strategies) {
        try {
            const res = await fetch(url, { 
                headers: strategy.headers,
                timeout: 10000
            });
            if (res.ok) {
                const text = await res.text();
                if (!text.includes('login') && !text.includes('signin') && !text.includes('auth')) {
                    return text;
                }
            }
        } catch(e) {
            continue;
        }
    }
    return null;
}

function extractLinkedInData(html, url) {
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

    // ============ METHOD 1: Extract from JSON-LD ============
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
                if (json.description && !data.about) data.about = json.description;
            }
        } catch(e) {}
    }

    // ============ METHOD 2: Extract from meta tags ============
    const metaTags = {
        title: html.match(/<meta property="og:title" content="([^"]*)"/),
        description: html.match(/<meta property="og:description" content="([^"]*)"/),
        url: html.match(/<meta property="og:url" content="([^"]*)"/)
    };

    if (metaTags.title && metaTags.title[1]) {
        let name = metaTags.title[1].replace(' | LinkedIn', '').replace(' - LinkedIn', '').trim();
        if (name && !data.fullName) {
            data.fullName = name;
            const parts = name.split(' ');
            data.firstName = parts[0] || '';
            data.lastName = parts.slice(1).join(' ') || '';
        }
    }

    if (metaTags.description && metaTags.description[1]) {
        const desc = metaTags.description[1];
        // Extract job title from description
        const titleMatch = desc.match(/^([^·|,]+)/);
        if (titleMatch && !data.jobTitle) {
            data.jobTitle = titleMatch[1].trim();
        }
        // Extract company from description
        const companyMatch = desc.match(/(?:at|@)\s+([A-Z][a-zA-Z0-9\s&.]+)/);
        if (companyMatch && !data.company) {
            data.company = companyMatch[1].trim();
        }
    }

    // ============ METHOD 3: Extract from HTML elements ============
    // Name from h1
    const h1Match = html.match(/<h1[^>]*>([^<]*)<\/h1>/);
    if (h1Match && h1Match[1].trim() && !data.fullName) {
        data.fullName = h1Match[1].trim();
        const parts = data.fullName.split(' ');
        data.firstName = parts[0] || '';
        data.lastName = parts.slice(1).join(' ') || '';
    }

    // Job title from various patterns
    if (!data.jobTitle) {
        const titlePatterns = [
            /<div[^>]*class="[^"]*text-body-medium[^"]*"[^>]*>([^<]*)<\/div>/,
            /<div[^>]*class="[^"]*headline[^"]*"[^>]*>([^<]*)<\/div>/,
            /<span[^>]*class="[^"]*top-card__subline-item[^"]*"[^>]*>([^<]*)<\/span>/
        ];
        for (const pattern of titlePatterns) {
            const match = html.match(pattern);
            if (match && match[1].trim()) {
                data.jobTitle = match[1].trim();
                break;
            }
        }
    }

    // Company from various patterns
    if (!data.company) {
        const companyPatterns = [
            /<a[^>]*data-anonymize="company-name"[^>]*>([^<]*)<\/a>/,
            /<span[^>]*class="[^"]*company-name[^"]*"[^>]*>([^<]*)<\/span>/,
            /"companyName":"([^"]+)"/,
            /at\s+([A-Z][a-zA-Z0-9\s&.]+)(?=\s*[,\|]|\s*$)/
        ];
        for (const pattern of companyPatterns) {
            const match = html.match(pattern);
            if (match && match[1].trim()) {
                data.company = match[1].trim();
                break;
            }
        }
    }

    // Location
    if (!data.location) {
        const locationPatterns = [
            /<span[^>]*class="[^"]*location[^"]*"[^>]*>([^<]*)<\/span>/,
            /"location":\{"@type":"Place","name":"([^"]+)"/
        ];
        for (const pattern of locationPatterns) {
            const match = html.match(pattern);
            if (match && match[1].trim()) {
                data.location = match[1].trim();
                break;
            }
        }
    }

    // About/Summary
    if (!data.about) {
        const aboutMatch = html.match(/"summary":"([^"]+)"/);
        if (aboutMatch) {
            data.about = aboutMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
        }
    }

    // Experience
    const expMatches = html.match(/"positions":\[([\s\S]*?)\]/);
    if (expMatches) {
        try {
            const positions = JSON.parse('[' + expMatches[1] + ']');
            if (Array.isArray(positions)) {
                data.experience = positions.map(p => {
                    const title = p.title || '';
                    const company = p.companyName || '';
                    const dateRange = p.dateRange || {};
                    const start = dateRange.start || '';
                    const end = dateRange.end || 'Present';
                    return `${title} at ${company} (${start} - ${end})`;
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

    // Education
    const eduMatch = html.match(/"education":\[([\s\S]*?)\]/);
    if (eduMatch) {
        try {
            const edu = JSON.parse('[' + eduMatch[1] + ']');
            if (Array.isArray(edu)) {
                data.education = edu.map(e => {
                    const school = e.schoolName || '';
                    const degree = e.degreeName || '';
                    const field = e.fieldOfStudy || '';
                    return `${degree} ${field} at ${school}`.trim();
                }).filter(Boolean);
            }
        } catch(e) {}
    }

    // ============ METHOD 4: Try to extract from text content ============
    // If still no data, try to parse visible text
    if (!data.fullName || !data.jobTitle) {
        const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const lines = textContent.split('.').filter(s => s.trim().length > 0);
        
        // Look for name pattern (2-3 words at start)
        if (!data.fullName) {
            const nameMatch = textContent.match(/^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
            if (nameMatch) {
                data.fullName = nameMatch[1];
                const parts = data.fullName.split(' ');
                data.firstName = parts[0] || '';
                data.lastName = parts.slice(1).join(' ') || '';
            }
        }
    }

    // Clean up
    Object.keys(data).forEach(key => {
        if (typeof data[key] === 'string') {
            data[key] = data[key]
                .replace(/\\/g, '')
                .replace(/"/g, '')
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .trim();
        }
        if (Array.isArray(data[key])) {
            data[key] = data[key].filter(Boolean);
        }
    });

    return data;
}
