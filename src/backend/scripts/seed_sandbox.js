const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dbPath = path.join(__dirname, 'sandbox_db.json');

const data = {
    sessions: {},
    users: {},
    repos: []
};

const NUM_USERS = 20;
const REPOS_PER_USER = 15;

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
}

for (let i = 0; i < NUM_USERS; i++) {
    const angle = (i / NUM_USERS) * Math.PI * 2;
    const distance = 4000 + Math.random() * 2000;
    
    const cx = Math.cos(angle) * distance;
    const cy = Math.sin(angle) * distance;
    
    const login = `Explorer_${i}`;
    const avatar = `https://avatars.githubusercontent.com/u/${1000 + i}?v=4`;
    const langs = ['JavaScript', 'TypeScript', 'Python', 'Rust', 'Go', 'C++'];
    const primaryLang = langs[i % langs.length];
    
    data.users[login] = {
        login,
        cx,
        cy,
        avatar,
        primary_language: primaryLang,
        first_seen: Date.now() - Math.random() * 10000000,
        last_login: Date.now()
    };
    
    for (let r = 0; r < REPOS_PER_USER; r++) {
        const repoAngle = (r / REPOS_PER_USER) * Math.PI * 2;
        const repoDist = 150 + Math.random() * 100;
        
        const size = Math.floor(Math.random() * 5000) + 100;
        const stars = Math.floor(Math.random() * 200);
        
        data.repos.push({
            login,
            name: `Project_${login}_${r}`,
            language: langs[(i + r) % langs.length],
            url: `https://github.com/${login}/repo_${r}`,
            size,
            stars,
            isFork: Math.random() > 0.8,
            description: `An amazing project built by ${login}`,
            updated_at: new Date().toISOString(),
            x: cx + Math.cos(repoAngle) * repoDist,
            y: cy + Math.sin(repoAngle) * repoDist,
            radius: Math.max(15, Math.min(50, Math.sqrt(size) / 2))
        });
    }
}

// Add a super massive central island to serve as a cool focal point
const centralLogin = 'GitSpace_Core';
data.users[centralLogin] = {
    login: centralLogin, cx: 0, cy: 0, avatar: 'https://avatars.githubusercontent.com/u/9919?v=4',
    primary_language: 'Rust', first_seen: Date.now(), last_login: Date.now()
};

for (let r = 0; r < 50; r++) {
    const repoAngle = (r / 50) * Math.PI * 2;
    const ring = Math.floor(r / 10) + 1;
    const repoDist = 200 * ring + Math.random() * 50;
    
    let stars = Math.floor(Math.random() * 500);
    let size = Math.floor(Math.random() * 10000);
    let name = `Core_Service_${r}`;
    
    if (r === 0) { stars = 15000; size = 150000; name = "The_Citadel"; }
    
    data.repos.push({
        login: centralLogin, name, language: 'Rust', url: `https://github.com/GitSpace/core`,
        size, stars, isFork: false, description: `Core system module ${r}`,
        updated_at: new Date().toISOString(),
        x: Math.cos(repoAngle) * repoDist,
        y: Math.sin(repoAngle) * repoDist,
        radius: Math.max(20, Math.min(80, Math.sqrt(size) / 2))
    });
}

fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
console.log(`Successfully generated sandbox_db.json with ${NUM_USERS + 1} users and ${data.repos.length} repos.`);
