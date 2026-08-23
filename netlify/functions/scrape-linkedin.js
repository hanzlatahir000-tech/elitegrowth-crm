// netlify/functions/scrape-linkedin.js
const fetch = require('node-fetch');

exports.handler = async (event) => {
    // Only allow POST
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

        // Fetch the LinkedIn profile page
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            }
        });

        if (!response.ok) {
            return {
                statusCode: response.status,
                body: JSON.stringify({ error: `Failed to fetch LinkedIn profile: ${response.status}` })
            };
        }

        const html = await response.text();

        // Check if we got a login page
        if (html.includes('login') || html.includes('signin') || html.includes('auth')) {
            return {
                statusCode: 403,
                body: JSON.stringify({ 
                    error: 'LinkedIn returned a login page. The profile may be private or LinkedIn is blocking requests. Try using screenshots instead.',
                    note: 'For private profiles, use the screenshot upload method.'
                })
            };
        }

        // Extract data from HTML using regex and patterns
        const data = extractLinkedInData(html, url);

        return {
            statusCode: 200,
            body: JSON.stringify(data)
        };

    } catch (error) {
        console.error('Scraping error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to scrape LinkedIn: ' + error.message })
        };
    }
};

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
        skills: [],
        linkedinUrl: url,
        scrapedAt: new Date().toISOString()
    };

    // Try to extract name - LinkedIn uses JSON-LD
    const nameMatch = html.match(/<title>(.*?)<\/title>/);
    if (nameMatch) {
        let name = nameMatch[1].replace(' | LinkedIn', '').trim();
        if (name) {
            data.fullName = name;
            const parts = name.split(' ');
            data.firstName = parts[0] || '';
            data.lastName = parts.slice(1).join(' ') || '';
        }
    }

    // Try to extract headline/job title from JSON-LD
    const headlineMatch = html.match(/"headline":"(.*?)"/);
    if (headlineMatch) {
        data.jobTitle = headlineMatch[1].replace(/\\"/g, '"');
    }

    // Try to extract company from JSON-LD
    const companyMatch = html.match(/"worksFor":\{"@type":"Organization","name":"(.*?)"/);
    if (companyMatch) {
        data.company = companyMatch[1];
    }

    // Try to extract location from JSON-LD
    const locationMatch = html.match(/"address":\{"addressCountry":"(.*?)"/);
    if (locationMatch) {
        data.location = locationMatch[1];
    }

    // Try to extract industry from JSON-LD
    const industryMatch = html.match(/"industry":"(.*?)"/);
    if (industryMatch) {
        data.industry = industryMatch[1];
    }

    // Try to extract about/summary
    const aboutMatch = html.match(/"summary":"(.*?)"/);
    if (aboutMatch) {
        data.about = aboutMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
    }

    // Try to extract experience
    const expMatches = html.match(/"positions":\[(.*?)\]/s);
    if (expMatches) {
        try {
            const positions = JSON.parse('[' + expMatches[1] + ']');
            if (Array.isArray(positions)) {
                data.experience = positions.map(p => {
                    return `${p.title || ''} at ${p.companyName || ''} (${p.dateRange?.start || ''} - ${p.dateRange?.end || 'Present'})`;
                }).filter(Boolean);
            }
        } catch(e) {}
    }

    // Try to extract skills
    const skillsMatch = html.match(/"skills":\[(.*?)\]/s);
    if (skillsMatch) {
        try {
            const skills = JSON.parse('[' + skillsMatch[1] + ']');
            if (Array.isArray(skills)) {
                data.skills = skills.map(s => s.name || s).filter(Boolean);
            }
        } catch(e) {}
    }

    // If we have minimal data, use alternative extraction
    if (!data.fullName && !data.jobTitle) {
        // Fallback: try to extract from visible text patterns
        const patterns = {
            fullName: /<h1 class="[^"]*">(.*?)<\/h1>/,
            jobTitle: /<div class="[^"]*">(.*?)<\/div>/
        };
        // ... additional fallback patterns
    }

    // Clean up
    Object.keys(data).forEach(key => {
        if (typeof data[key] === 'string') {
            data[key] = data[key].replace(/\\/g, '').replace(/"/g, '').trim();
        }
    });

    return data;
}
