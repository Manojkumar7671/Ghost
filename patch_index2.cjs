const fs = require('fs');
let content = fs.readFileSync('public/index.html', 'utf8');

// Replace tab list
content = content.replace(
    '<button class="personal-tab-btn" id="tabMemoriesBtn" role="tab" aria-selected="false" data-tab="memories">Saved Memories</button>',
    '<button class="personal-tab-btn" id="tabMemoriesBtn" role="tab" aria-selected="false" data-tab="memories">Saved Memories</button>\n                <button class="personal-tab-btn" id="tabSkillsBtn" role="tab" aria-selected="false" data-tab="skills">Skills V0</button>'
);

// Add Tab Content 6 before the closing </div></div> (which is the modal body/content)
// Let's find "<!-- Tab Content 5: Saved Memories List -->" and the end of its div.
const panel6 = `

            <!-- Tab Content 6: Skills V0 -->
            <div id="tabContentSkills" class="personal-tab-panel" role="tabpanel" style="display: none;">
                <div class="panel-section-title">Ghost Skills V0</div>
                <p class="panel-subtext">Verified working capabilities and their explicit limitations.</p>
                <div id="skillsListContainer" class="skills-card-list">
                    <div class="loading-state">Loading skills...</div>
                </div>
            </div>
`;
// find the end of tabContentMemories
const targetStr = `                <div id="memoriesListContainer" class="personal-items-list">
                    <div class="loading-state">Loading memories...</div>
                </div>
            </div>`;
content = content.replace(targetStr, targetStr + panel6);

fs.writeFileSync('public/index.html', content);
console.log('Patched index.html correctly');
