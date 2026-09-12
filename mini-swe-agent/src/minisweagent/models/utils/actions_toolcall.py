"""Parse actions & format observations with toolcalls"""

import json
import time

from jinja2 import StrictUndefined, Template

from minisweagent.exceptions import FormatError
from minisweagent.models.utils.openai_multimodal import expand_multimodal_content

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


def format_toolcall_observation_messages(
    *,
    actions: list[dict],
    outputs: list[dict],
    observation_template: str,
    template_vars: dict | None = None,
    multimodal_regex: str = "",
) -> list[dict]:
    """Format execution outputs into tool result messages."""
    not_executed = {"output": "", "returncode": -1, "exception_info": "action was not executed"}
    padded_outputs = outputs + [not_executed] * (len(actions) - len(outputs))
    results = []
    for action, output in zip(actions, padded_outputs):
        content = Template(observation_template, undefined=StrictUndefined).render(
            output=output, **(template_vars or {})
        )
        msg = {
            "content": content,
            "extra": {
                "raw_output": output.get("output", ""),
                "returncode": output.get("returncode"),
                "timestamp": time.time(),
                "exception_info": output.get("exception_info"),
                **output.get("extra", {}),
            },
        }
        if "tool_call_id" in action:
            msg["tool_call_id"] = action["tool_call_id"]
            msg["role"] = "tool"
        else:
            msg["role"] = "user"  # human issued commands
        if multimodal_regex:
            msg = expand_multimodal_content(msg, pattern=multimodal_regex)
        results.append(msg)
    return results
