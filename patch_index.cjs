const fs = require('fs');
let content = fs.readFileSync('public/index.html', 'utf8');

const newTab = `<button class="personal-tab-btn" data-tab="tabContentSkills">Skills V0</button>\n        </div>`;
content = content.replace('</div>', newTab); // Wait, replacing first </div> will break things.

// Let's do a precise replace for tabs
content = content.replace(
    `<button class="personal-tab-btn" data-tab="tabContentMemories">Saved Memories</button>`,
    `<button class="personal-tab-btn" data-tab="tabContentMemories">Saved Memories</button>\n            <button class="personal-tab-btn" id="tabSkillsBtn" data-tab="tabContentSkills">Skills V0</button>`
);

const newPanel = `
            <!-- Tab Content 6: Skills V0 -->
            <div id="tabContentSkills" class="personal-tab-panel" role="tabpanel" style="display: none;">
                <div class="panel-section-title">Ghost Skills V0</div>
                <p class="panel-subtext">Verified working capabilities and their explicit limitations.</p>
                <div id="skillsListContainer" class="personal-items-list">
                    <div class="loading-state">Loading skills...</div>
                </div>
            </div>
        </div>
    </div>
`;
content = content.replace(
    `</div>\n    </div>\n\n    <script src="/ghost-ui.js"></script>`,
    newPanel + `\n    <script src="/ghost-ui.js"></script>`
);

fs.writeFileSync('public/index.html', content);
console.log('Patched index.html');
