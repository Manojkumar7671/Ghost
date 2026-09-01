import re

with open("mini-swe-agent/src/minisweagent/models/utils/actions_toolcall.py", "r") as f:
    content = f.read()

new_tools = """
BASH_TOOL = [
  {
    "type": "function",
    "function": {
      "name": "list_files",
      "description": "List files in a directory",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {"type": "string", "description": "Relative path to directory"}
        },
        "required": ["path"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "read_file",
      "description": "Read content of a file",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {"type": "string", "description": "Relative path to file"}
        },
        "required": ["path"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "write_file",
      "description": "Write content to a file",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {"type": "string", "description": "Relative path to file"},
          "content": {"type": "string", "description": "File content"}
        },
        "required": ["path", "content"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "edit_file",
      "description": "Edit a file using search and replace",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {"type": "string", "description": "Relative path to file"},
          "search": {"type": "string", "description": "Text to search for"},
          "replace": {"type": "string", "description": "Replacement text"}
        },
        "required": ["path", "search", "replace"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "run_command",
      "description": "Run a shell command",
      "parameters": {
        "type": "object",
        "properties": {
          "command": {"type": "string", "description": "Shell command to run"}
        },
        "required": ["command"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "run_tests",
      "description": "Run the test suite",
      "parameters": {
        "type": "object",
        "properties": {
          "command": {"type": "string", "description": "Test command to run"}
        },
        "required": ["command"]
      }
    }
  }
]
"""

content = re.sub(r'BASH_TOOL = \{.*?\n\}', new_tools.strip(), content, flags=re.DOTALL)

# Now rewrite parse_toolcall_actions to accept all of them
new_parse = """
def parse_toolcall_actions(
    tool_calls: list, *, format_error_template: str, template_kwargs: dict | None = None
) -> list[dict]:
    template_kwargs = template_kwargs or {}
    if not tool_calls:
        raise FormatError(
            {
                "role": "user",
                "content": "No tool calls found in the response. Every response MUST include at least one tool call.",
                "extra": {"interrupt_type": "FormatError"},
            }
        )
    actions = []
    
    # We must support the new tools
    valid_tools = ["list_files", "read_file", "write_file", "edit_file", "run_command", "run_tests"]
    
    for tool_call in tool_calls:
        error_msg = ""
        args = {}
        try:
            args = json.loads(tool_call.function.arguments)
        except Exception as e:
            error_msg = f"Error parsing tool call arguments: {e}."
            
        if tool_call.function.name not in valid_tools:
            error_msg += f"Unknown tool '{tool_call.function.name}'."
            
        # Check required fields
        if tool_call.function.name in ["list_files", "read_file"] and "path" not in args:
            error_msg += f"Missing 'path' argument in {tool_call.function.name}."
        elif tool_call.function.name == "write_file" and ("path" not in args or "content" not in args):
            error_msg += "Missing 'path' or 'content' in write_file."
        elif tool_call.function.name == "edit_file" and ("path" not in args or "search" not in args or "replace" not in args):
            error_msg += "Missing 'path', 'search', or 'replace' in edit_file."
        elif tool_call.function.name in ["run_command", "run_tests"] and "command" not in args:
            error_msg += f"Missing 'command' argument in {tool_call.function.name}."
            
        if error_msg:
            raise FormatError(
                {
                    "role": "user",
                    "content": f"Schema validation error: {error_msg.strip()}",
                    "extra": {"interrupt_type": "FormatError"},
                }
            )
            
        actions.append({"tool_name": tool_call.function.name, "args": args, "tool_call_id": tool_call.id})
    return actions
"""

content = re.sub(r'def parse_toolcall_actions.*?return actions', new_parse.strip(), content, flags=re.DOTALL)

with open("mini-swe-agent/src/minisweagent/models/utils/actions_toolcall.py", "w") as f:
    f.write(content)
