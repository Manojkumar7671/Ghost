import re

with open('public/ghost-ui.js', 'r') as f:
    js = f.read()

pipeline_start = """
        const pipeWidget = document.getElementById('livePipelineWidget');
        const pipePlan = document.getElementById('pipePlan');
        const pipeExecute = document.getElementById('pipeExecute');
        const pipeVerify = document.getElementById('pipeVerify');
        const pipeStatusBadge = document.getElementById('pipeStatusBadge');
        if (pipeWidget) pipeWidget.style.display = 'flex';
        if (pipeStatusBadge) {
            pipeStatusBadge.innerText = 'Running';
            pipeStatusBadge.style.background = '#007aff';
        }
        if (pipePlan) pipePlan.style.color = 'black';
        
        let pipeInterval = null;
        if (pipeWidget) {
            let stage = 0;
            pipeInterval = setInterval(() => {
                stage++;
                if (stage === 1) {
                    if (pipePlan) pipePlan.style.color = 'gray';
                    if (pipeExecute) pipeExecute.style.color = 'black';
                } else if (stage === 2) {
                    if (pipeExecute) pipeExecute.style.color = 'gray';
                    if (pipeVerify) pipeVerify.style.color = 'black';
                }
            }, 3000);
        }
"""

pipeline_end = """
            if (pipeInterval) clearInterval(pipeInterval);
            if (pipeStatusBadge) {
                pipeStatusBadge.innerText = 'Idle';
                pipeStatusBadge.style.background = '#333';
            }
            if (pipePlan) pipePlan.style.color = 'gray';
            if (pipeExecute) pipeExecute.style.color = 'gray';
            if (pipeVerify) pipeVerify.style.color = 'gray';
"""

# Insert pipeline_start right after targetUrl is resolved (before fetch)
fetch_start = js.find("const response = await fetch(targetUrl, {")
js = js[:fetch_start] + pipeline_start + js[fetch_start:]

# Insert pipeline_end after response returns and clears timeout
timeout_clear = js.find("clearTimeout(timeoutId);", fetch_start) + len("clearTimeout(timeoutId);")
js = js[:timeout_clear] + pipeline_end + js[timeout_clear:]

# Handle error cases for clearing pipeline
catch_block = js.find("} catch (error) {", timeout_clear) + len("} catch (error) {")
js = js[:catch_block] + pipeline_end + js[catch_block:]

with open('public/ghost-ui.js', 'w') as f:
    f.write(js)
