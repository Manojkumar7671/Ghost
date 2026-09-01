import re

with open('public/ghost-ui.js', 'r') as f:
    js = f.read()

# Add logic inside processCommand
easter_egg_code = """
        if (!isAdminMode) {
            window.visitorInteractionCount = (window.visitorInteractionCount || 0) + 1;
            if (window.visitorInteractionCount >= 2 && !window.hasShownVisitorEasterEgg) {
                window.hasShownVisitorEasterEgg = true;
                setTimeout(() => {
                    appendMessage('ghost', "You're seeing the guest view. The full version is what Manoj built and runs day to day. Hire him and find out.");
                }, 1500);
            }
        }
"""

# Insert right after `isSubmitting = true;` inside `processCommand`
process_command_start = js.find('async function processCommand(textCommand) {')
is_submitting_index = js.find('isSubmitting = true;', process_command_start) + len('isSubmitting = true;')

js = js[:is_submitting_index] + easter_egg_code + js[is_submitting_index:]

with open('public/ghost-ui.js', 'w') as f:
    f.write(js)
