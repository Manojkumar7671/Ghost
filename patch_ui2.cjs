const fs = require('fs');
let content = fs.readFileSync('public/ghost-ui.js', 'utf8');

// Add tab button and panel references
const refTarget = `const tabMemoriesBtn = document.getElementById('tabMemoriesBtn');`;
const refReplace = `const tabMemoriesBtn = document.getElementById('tabMemoriesBtn');
    const tabSkillsBtn = document.getElementById('tabSkillsBtn');`;
content = content.replace(refTarget, refReplace);

const panelRefTarget = `const tabContentMemories = document.getElementById('tabContentMemories');`;
const panelRefReplace = `const tabContentMemories = document.getElementById('tabContentMemories');
    const tabContentSkills = document.getElementById('tabContentSkills');
    const skillsListContainer = document.getElementById('skillsListContainer');`;
content = content.replace(panelRefTarget, panelRefReplace);

// Add event listener
const listenerTarget = `if (tabMemoriesBtn) tabMemoriesBtn.addEventListener('click', () => switchPersonalTab('memories'));`;
const listenerReplace = `if (tabMemoriesBtn) tabMemoriesBtn.addEventListener('click', () => switchPersonalTab('memories'));
        if (tabSkillsBtn) tabSkillsBtn.addEventListener('click', () => switchPersonalTab('skills'));`;
content = content.replace(listenerTarget, listenerReplace);

// Modify switchPersonalTab
const switchTarget = `{ name: 'memories', btn: tabMemoriesBtn, panel: tabContentMemories }`;
const switchReplace = `{ name: 'memories', btn: tabMemoriesBtn, panel: tabContentMemories },
            { name: 'skills', btn: tabSkillsBtn, panel: tabContentSkills }`;
content = content.replace(switchTarget, switchReplace);

// Add fetch trigger inside switchPersonalTab or loadPersonalOverview
const loadHookTarget = `if (isActive && t.name === 'memories') loadPersonalOverview();`;
// Let's replace the whole tabs.forEach to trigger loadSkills
const tabsForeachTarget = `tabs.forEach(t => {
            if (t.btn && t.panel) {
                const isActive = t.name === tabName;
                t.btn.classList.toggle('active', isActive);
                t.btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
                t.panel.style.display = isActive ? 'block' : 'none';
                t.panel.classList.toggle('active', isActive);
            }
        });`;
const tabsForeachReplace = `tabs.forEach(t => {
            if (t.btn && t.panel) {
                const isActive = t.name === tabName;
                t.btn.classList.toggle('active', isActive);
                t.btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
                t.panel.style.display = isActive ? 'block' : 'none';
                t.panel.classList.toggle('active', isActive);
                if (isActive && t.name === 'skills') loadSkillsV0();
            }
        });`;
content = content.replace(tabsForeachTarget, tabsForeachReplace);

// Append loadSkillsV0 and renderSkills function
const newFunctions = `
    async function loadSkillsV0() {
        if (!skillsListContainer) return;
        skillsListContainer.innerHTML = '<div class="loading-state">Loading skills...</div>';
        try {
            const res = await fetch(apiUrl('/api/skills'), { credentials: 'include' });
            const data = await res.json();
            if (res.ok && data.success) {
                renderSkillsList(data.skills);
            } else {
                skillsListContainer.innerHTML = '<div class="loading-state">Failed to load skills.</div>';
            }
        } catch (err) {
            skillsListContainer.innerHTML = '<div class="loading-state">Error loading skills.</div>';
        }
    }

    function renderSkillsList(skills) {
        if (!skillsListContainer) return;
        skillsListContainer.innerHTML = '';
        if (!skills || skills.length === 0) {
            skillsListContainer.innerHTML = '<div class="empty-state">No skills available.</div>';
            return;
        }
        skills.forEach(skill => {
            const card = document.createElement('div');
            card.className = 'personal-item-card';
            card.style.borderLeft = '3px solid var(--accent-primary)';
            card.style.padding = '12px';
            card.style.marginBottom = '12px';
            card.style.backgroundColor = 'var(--surface-color)';
            card.style.borderRadius = '4px';

            const title = document.createElement('h4');
            title.textContent = skill.title;
            title.style.margin = '0 0 8px 0';

            const desc = document.createElement('p');
            desc.textContent = skill.whatItDoes;
            desc.style.margin = '0 0 8px 0';
            desc.style.fontSize = '0.9em';

            const limit = document.createElement('div');
            limit.style.fontSize = '0.85em';
            limit.style.color = 'var(--text-secondary)';
            limit.style.padding = '6px';
            limit.style.backgroundColor = 'var(--background-color)';
            limit.style.borderRadius = '4px';
            limit.style.border = '1px solid var(--border-color)';
            limit.innerHTML = '<strong>Limit:</strong> ' + skill.exactLimit;

            card.appendChild(title);
            card.appendChild(desc);
            card.appendChild(limit);
            skillsListContainer.appendChild(card);
        });
    }
`;
content += newFunctions;

fs.writeFileSync('public/ghost-ui.js', content);
console.log('Patched ghost-ui.js for skills');
