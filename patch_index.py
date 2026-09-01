import re

with open('public/index.html', 'r') as f:
    html = f.read()

# Replace sidebar nav
nav_start = html.find('<nav class="sidebar-nav">')
nav_end = html.find('</nav>', nav_start) + 6

new_nav = '''<nav class="sidebar-nav">
                <button type="button" class="nav-item active" id="navChatBtn" title="Chat">
                    <span class="nav-icon">💬</span>
                    <span class="nav-label">Chat</span>
                </button>
                <button type="button" class="nav-item" id="navCodingAgentBtn" title="Coding agent">
                    <span class="nav-icon">💻</span>
                    <span class="nav-label">Coding agent</span>
                </button>
                <button type="button" class="nav-item" id="navResearchBtn" title="Research">
                    <span class="nav-icon">🔍</span>
                    <span class="nav-label">Research</span>
                </button>
                <button type="button" class="nav-item" id="navMemoryBtn" title="Memory">
                    <span class="nav-icon">🗄️</span>
                    <span class="nav-label">Memory</span>
                </button>
            </nav>'''

html = html[:nav_start] + new_nav + html[nav_end:]

# Remove Actions dropdown
actions_start = html.find('<div class="workspace-actions-wrapper" id="workspaceActionsWrapper">')
actions_end = html.find('</div>', html.find('</div>', actions_start) + 1)
# Actually, the Actions dropdown ends further down. Let's use regex or just replace the whole wrapper.
actions_wrapper_pattern = r'<div class="workspace-actions-wrapper".*?id="workspaceActionsWrapper">.*?</div>\s*</div>'
html = re.sub(actions_wrapper_pattern, '', html, flags=re.DOTALL)

# Add "live pipeline" status widget
header_actions_start = html.find('<div class="header-actions">')
if header_actions_start != -1:
    pipeline_widget = '''
                    <div id="livePipelineWidget" class="pipeline-widget" style="display: flex; align-items: center; gap: 8px; margin-right: 16px; font-size: 0.85rem;">
                        <span id="pipePlan" class="pipe-stage" style="color: gray;">Plan</span> ➔ 
                        <span id="pipeExecute" class="pipe-stage" style="color: gray;">Execute</span> ➔ 
                        <span id="pipeVerify" class="pipe-stage" style="color: gray;">Verify</span>
                        <span id="pipeStatusBadge" class="status-badge" style="margin-left: 8px; padding: 2px 6px; border-radius: 4px; background: #333; color: white;">Idle</span>
                    </div>
'''
    html = html[:header_actions_start + 28] + pipeline_widget + html[header_actions_start + 28:]

with open('public/index.html', 'w') as f:
    f.write(html)

