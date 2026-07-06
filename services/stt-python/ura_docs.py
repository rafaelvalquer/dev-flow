import base64
import csv
import html
import io
import json
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel

app = FastAPI(title="Dev Flow URA Docs", version="1.0.0")

URA_DOCS_PARSER_NAME = "nice_action_struct"
URA_DOCS_PARSER_VERSION = "2026-07-03.1"

WAV_RE = re.compile(r"(?P<path>[A-Za-z0-9_./\\\\ -]+\.wav)", re.IGNORECASE)
VAR_RE = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]*)\b")
ASSIGN_RE = re.compile(
    r"(?:^|\n)\s*(?:ASSIGN\s+)?([A-Za-z_][\w:]*|global:[A-Za-z_][\w:]*)\s*=\s*(\"[^\"]*\"|'[^']*'|[^\r\n]+)",
    re.IGNORECASE,
)


class PackageRequest(BaseModel):
    normalized_flow: Dict[str, Any]
    transcriptions: Dict[str, Any] = {}
    ai_enrichment: Dict[str, Any] = {}
    options: Dict[str, Any] = {}


@dataclass
class ExecutionContext:
    variables: Dict[str, str] = field(default_factory=dict)
    path_digits: List[str] = field(default_factory=list)
    selected_cases: Dict[str, str] = field(default_factory=dict)
    current_menu_variable: str = ""
    last_audio: str = ""
    last_next_step: str = ""
    visited: Set[str] = field(default_factory=set)
    warnings: List[str] = field(default_factory=list)

    def clone(self) -> "ExecutionContext":
        return ExecutionContext(
            variables=dict(self.variables),
            path_digits=list(self.path_digits),
            selected_cases=dict(self.selected_cases),
            current_menu_variable=self.current_menu_variable,
            last_audio=self.last_audio,
            last_next_step=self.last_next_step,
            visited=set(self.visited),
            warnings=list(self.warnings),
        )

    def get(self, key: Any) -> str:
        text = clean_text(key)
        if not text:
            return ""
        return clean_text(self.variables.get(text) or self.variables.get(text.upper()) or self.variables.get(text.lower()))

    def set(self, key: Any, value: Any) -> None:
        text = clean_text(key)
        if not text:
            return
        resolved = resolve_value_from_context(value, self)
        if text.upper() in {"NEXT_STEP", "TRANSFERCODE", "SKILL_ID", "SKILL_NAME"}:
            resolved = clean_flow_target_value(resolved)
        self.variables[text] = resolved
        self.variables[text.upper()] = resolved
        if text.lower() != text.upper():
            self.variables[text.lower()] = resolved
        if is_audio_context_key(text) and resolved:
            self.last_audio = resolved
        if text.upper() == "NEXT_STEP" and resolved:
            self.last_next_step = resolved

    def apply_assignments(self, assignments: Dict[str, str]) -> None:
        for key, value in (assignments or {}).items():
            self.set(key, value)
        mresf = "".join(clean_text(self.get(key)) for key in ["MRES", "MRES1", "MRES2"])
        if mresf and not self.get("MRESF"):
            self.set("MRESF", mresf)
        mresf1 = clean_text(self.get("MRESF")) + clean_text(self.get("MRES3"))
        if mresf1.strip() and not self.get("MRESF1"):
            self.set("MRESF1", mresf1)

    def snapshot(self) -> Dict[str, str]:
        return {key: clean_text(value) for key, value in self.variables.items() if clean_text(value)}


def as_list(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return list(value)
    return [value]


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def clean_target(value: Any) -> str:
    if isinstance(value, dict):
        value = (
            value.get("target")
            or value.get("actionId")
            or value.get("ActionID")
            or value.get("ActionId")
            or value.get("id")
        )
    text = clean_text(value)
    if not text or text in {"-1", "0"}:
        return ""
    if text.startswith("{") or text.startswith("["):
        return ""
    try:
        number = int(float(text.replace(",", ".")))
        return str(number) if number > 0 else ""
    except ValueError:
        return text


def values_equal_key(key: Any, names: Any) -> bool:
    wanted = {normalized_key(name) for name in as_list(names)}
    return normalized_key(key) in wanted


def merge_repeated(target: Dict[str, Any], key: str, value: Any) -> None:
    if key not in target:
        target[key] = value
        return
    existing = target[key]
    if not isinstance(existing, list):
        existing = [existing]
    if isinstance(value, list):
        existing.extend(value)
    else:
        existing.append(value)
    target[key] = existing


def simplify_xml_node(node: ET.Element, depth: int = 0) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"_tag": local_name(node.tag)}
    for key, value in node.attrib.items():
        payload[local_name(key)] = value
    text = clean_text(node.text)
    if text:
        payload["_text"] = text
    if depth > 12:
        return payload
    for child in list(node):
        child_payload = simplify_xml_node(child, depth + 1)
        child_tag = local_name(child.tag)
        if len(child_payload) == 2 and "_tag" in child_payload and "_text" in child_payload and not child.attrib:
            child_payload = child_payload["_text"]
        merge_repeated(payload, child_tag, child_payload)
    return payload


def iter_dicts(value: Any):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from iter_dicts(child)
    elif isinstance(value, list):
        for item in value:
            yield from iter_dicts(item)


def find_first(value: Any, names: Any) -> Any:
    wanted = names if isinstance(names, set) else {normalized_key(name) for name in as_list(names)}
    if isinstance(value, dict):
        for key, item in value.items():
            if normalized_key(key) in wanted and clean_text(item):
                return item
        for item in value.values():
            found = find_first(item, wanted)
            if clean_text(found):
                return found
    elif isinstance(value, list):
        for item in value:
            found = find_first(item, wanted)
            if clean_text(found):
                return found
    return ""


def collect_named_dicts(value: Any, names: Any) -> List[Dict[str, Any]]:
    wanted = names if isinstance(names, set) else {normalized_key(name) for name in as_list(names)}
    found: List[Dict[str, Any]] = []
    if isinstance(value, dict):
        tag = normalized_key(value.get("_tag"))
        if tag in wanted and not tag.endswith("s"):
            found.append(value)
        for key, item in value.items():
            if normalized_key(key) in wanted:
                if normalized_key(key).endswith("s") and isinstance(item, (dict, list)):
                    pass
                else:
                    for entry in as_list(item):
                        if isinstance(entry, dict):
                            found.append(entry)
            if isinstance(item, (dict, list)):
                found.extend(collect_named_dicts(item, wanted))
    elif isinstance(value, list):
        for item in value:
            found.extend(collect_named_dicts(item, wanted))
    return found


def to_simple_parameters(value: Any) -> Any:
    if isinstance(value, dict) and value.get("_niceTyped"):
        return [clean_text(item) for item in as_list(value.get("Parameters"))]
    params = find_first(value, ("Parameters", "Params", "ParameterList", "parameterList"))
    if not isinstance(params, (dict, list)):
        return params if clean_text(params) else {}
    if isinstance(params, list):
        result: Dict[str, Any] = {}
        for item in params:
            if not isinstance(item, dict):
                continue
            key = clean_text(find_first(item, ("Name", "Key", "ParameterName", "name", "key")))
            val = find_first(item, ("Value", "DefaultValue", "Text", "_text", "value"))
            if key:
                result[key] = val
        return result or params
    return params


def first_number(value: Any, names: Any) -> Any:
    candidate = find_first(value, names)
    try:
        return int(float(clean_text(candidate).replace(",", ".")))
    except (TypeError, ValueError):
        return ""


def has_real_action_id(value: Dict[str, Any]) -> bool:
    return bool(clean_text(find_first(value, ("ActionID", "ActionId", "actionId", "ID", "Id", "id"))))


def has_action_content(value: Dict[str, Any]) -> bool:
    field_names = (
        "Action",
        "ActionType",
        "Type",
        "Caption",
        "Label",
        "Description",
        "Parameters",
        "Branches",
        "Cases",
        "DefaultNextAction",
        "NextAction",
        "LibraryID",
        "X",
        "Y",
    )
    return any(clean_text(find_first(value, (name,))) for name in field_names)


def looks_like_xml_action(node: ET.Element, payload: Dict[str, Any]) -> bool:
    tag = normalized_key(node.tag)
    if tag in {"actions", "actionlist", "flow", "project", "root"}:
        return False
    if has_real_action_id(payload) and has_action_content(payload):
        return True
    return tag in {"action", "actionitem", "state", "node"} and has_real_action_id(payload)


def local_name(value: Any) -> str:
    return str(value or "").split("}")[-1].strip()


def normalized_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", local_name(value).lower())


def action_id(action: Dict[str, Any], index: int) -> str:
    if action.get("_niceTyped"):
        return clean_text(action.get("ActionID") or str(index + 1))
    return clean_text(find_first(action, ("ActionID", "ActionId", "actionId", "ID", "Id", "id")) or str(index + 1))


def action_type(action: Dict[str, Any]) -> str:
    if action.get("_niceTyped"):
        return clean_text(action.get("Action")).upper()
    return clean_text(find_first(action, ("Action", "ActionType", "Type", "type", "Name", "Class"))).upper()


def action_caption(action: Dict[str, Any]) -> str:
    if action.get("_niceTyped"):
        return clean_text(action.get("Caption") or action.get("Action"))
    return clean_text(find_first(action, ("Caption", "caption", "Label", "Description", "Text", "Name")))


def decode_upload(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="ignore")


def parse_source_text(text: str) -> Any:
    stripped = text.strip()
    if stripped.startswith("INCONTROL.NET-COPYCUTCOMMAND"):
        _, _, tail = stripped.partition("\n")
        stripped = tail.strip()
    if stripped.startswith("{") or stripped.startswith("["):
        return json.loads(stripped)
    if stripped.startswith("<"):
        return parse_xml_to_actions(stripped)
    raise ValueError("Formato NICE nao reconhecido. Envie XML, JSON ou COPYCUTCOMMAND.")


def direct_child(node: ET.Element, tag_name: str) -> Any:
    wanted = normalized_key(tag_name)
    for child in list(node):
        if normalized_key(child.tag) == wanted:
            return child
    return None


def direct_children(node: Any, tag_name: str) -> List[ET.Element]:
    if node is None:
        return []
    wanted = normalized_key(tag_name)
    return [child for child in list(node) if normalized_key(child.tag) == wanted]


def text_of(node: Any, tag_name: str) -> str:
    child = direct_child(node, tag_name)
    return clean_text(child.text if child is not None else "")


def parse_string_list(node: Any) -> List[str]:
    if node is None:
        return []
    strings = [child.text or "" for child in direct_children(node, "string")]
    if strings:
        return strings
    text = clean_text(node.text)
    return [text] if text else []


def parse_segments(node: Any) -> List[Dict[str, int]]:
    segments = []
    for point in direct_children(node, "Point"):
        try:
            x = int(float(text_of(point, "X").replace(",", ".")))
        except ValueError:
            x = 0
        try:
            y = int(float(text_of(point, "Y").replace(",", ".")))
        except ValueError:
            y = 0
        segments.append({"X": x, "Y": y})
    return segments


def parse_branch_struct(node: Any, action_id_tag: str = "ActionID") -> Any:
    if node is None:
        return None
    target = clean_target(text_of(node, action_id_tag) or text_of(node, "ActionId"))
    if not target:
        return None
    return {
        "target": target,
        "actionId": target,
        "text": text_of(node, "Text"),
        "keyName": text_of(node, "KeyName"),
        "index": clean_text(text_of(node, "Index")),
        "segments": parse_segments(direct_child(node, "Segments")),
    }


def parse_branch_info(node: Any) -> Any:
    return parse_branch_struct(node, "ActionId")


def parse_branch_list(node: Any) -> List[Dict[str, Any]]:
    return [item for item in (parse_branch_struct(child) for child in direct_children(node, "BranchStruct")) if item]


def parse_extra_info(node: Any) -> Dict[str, Any]:
    if node is None:
        return {"defaultBranch": None, "branches": [], "caseBranches": []}
    return {
        "defaultBranch": parse_branch_info(direct_child(node, "DefaultBranch")),
        "branches": [item for item in (parse_branch_info(child) for child in direct_children(direct_child(node, "Branches"), "BranchInfo")) if item],
        "caseBranches": [item for item in (parse_branch_info(child) for child in direct_children(direct_child(node, "CaseBranches"), "BranchInfo")) if item],
    }


def parse_action_struct(node: ET.Element) -> Dict[str, Any]:
    extra_info = parse_extra_info(direct_child(node, "ExtraInfo"))
    default_branch = parse_branch_struct(direct_child(node, "DefaultNextAction"))
    if not default_branch and extra_info.get("defaultBranch"):
        default_branch = extra_info["defaultBranch"]
    cases = parse_branch_list(direct_child(node, "Cases"))
    if not cases:
        cases = extra_info.get("caseBranches", [])
    branches = parse_branch_list(direct_child(node, "Branches"))
    if not branches:
        branches = extra_info.get("branches", [])
    return {
        "_tag": "ActionStruct",
        "_niceTyped": True,
        "ActionID": clean_text(text_of(node, "ActionID")),
        "Action": clean_text(text_of(node, "Action")),
        "Caption": clean_text(text_of(node, "Caption")),
        "Parameters": parse_string_list(direct_child(node, "Parameters")),
        "DefaultNextAction": default_branch.get("target") if default_branch else "",
        "DefaultNextActionBranch": default_branch,
        "Branches": branches,
        "Cases": cases,
        "X": clean_text(text_of(node, "X")),
        "Y": clean_text(text_of(node, "Y")),
        "DependencyOrder": clean_text(text_of(node, "DependencyOrder")),
        "Impl_Type": clean_text(text_of(node, "Impl_Type")),
        "LibraryID": clean_text(text_of(node, "LibraryID")),
        "ExtraInfo": extra_info,
        "xws": clean_text(text_of(node, "xws")),
        "yws": clean_text(text_of(node, "yws")),
    }


def parse_xml_to_actions(text: str) -> Dict[str, Any]:
    root = ET.fromstring(text)
    typed_action_nodes = [node for node in root.iter() if normalized_key(node.tag) == "actionstruct"]
    if typed_action_nodes:
        actions = [parse_action_struct(node) for node in typed_action_nodes]
        actions = [action for action in actions if clean_text(action.get("ActionID"))]
        return {
            "Actions": actions,
            "Project": {
                "source": "NICE Studio XML",
                "busNo": clean_text(root.attrib.get("BusNo")),
                "userId": clean_text(root.attrib.get("UserID")),
            },
            "_sourceFormat": "xml",
            "_parser": "nice_action_struct",
        }
    actions: List[Dict[str, Any]] = []
    seen = set()
    for node in root.iter():
        payload = simplify_xml_node(node)
        if not looks_like_xml_action(node, payload):
            continue
        aid = clean_text(find_first(payload, ("ActionID", "ActionId", "actionId", "ID", "Id", "id")))
        marker = aid or json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
        if marker in seen:
            continue
        seen.add(marker)
        actions.append(payload)
    return {
        "Actions": actions,
        "Project": {"source": "NICE Studio XML"},
        "_sourceFormat": "xml",
    }


def find_actions(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("Actions", "actions", "ActionList", "actionList"):
        if isinstance(payload.get(key), list):
            return [item for item in payload[key] if isinstance(item, dict)]
    for value in payload.values():
        if isinstance(value, dict):
            nested = find_actions(value)
            if nested:
                return nested
    return []


def extract_project(payload: Any, fallback_name: str) -> Dict[str, Any]:
    if isinstance(payload, dict):
        project = payload.get("Project") or payload.get("project") or {}
        return {
            "name": clean_text(project.get("name") or project.get("Name") or fallback_name),
            "source": clean_text(project.get("source") or project.get("Source") or "NICE Studio"),
            "version": clean_text(project.get("version") or project.get("Version") or ""),
        }
    return {"name": fallback_name, "source": "NICE Studio", "version": ""}


def stringify_parameters(action: Dict[str, Any]) -> str:
    return json.dumps(action, ensure_ascii=False, default=str)


def action_code(action: Dict[str, Any]) -> str:
    params = to_simple_parameters(action)
    if isinstance(params, list):
        return "\n".join(clean_text(item) for item in params)
    if isinstance(params, dict):
        return "\n".join(clean_text(value) for value in params.values())
    return clean_text(params)


def clean_assignment_value(value: Any) -> str:
    text = clean_text(value)
    text = re.sub(r"\s*//.*$", "", text).strip()
    if (text.startswith('"') and text.endswith('"')) or (text.startswith("'") and text.endswith("'")):
        text = text[1:-1].strip()
    return text


def clean_flow_target_value(value: Any) -> str:
    text = clean_assignment_value(value)
    text = re.sub(r"^\{[^}]+\}", "", text).strip()
    text = text.strip("\"'")
    return text


def parse_assignments(code: str) -> Dict[str, str]:
    assignments: Dict[str, str] = {}
    for match in ASSIGN_RE.finditer(clean_text(code)):
        assignments[match.group(1)] = clean_assignment_value(match.group(2))
    return assignments


def first_assignment(assignments: Dict[str, str], names: List[str]) -> str:
    lower = {key.lower(): value for key, value in assignments.items()}
    for name in names:
        value = lower.get(name.lower())
        if value:
            return value
    return ""


def summarize_action_output(action: Dict[str, Any]) -> Dict[str, str]:
    assignments = parse_assignments(action_code(action))
    return {
        "audio": first_assignment(assignments, ["AUDIO", "audio"]),
        "nextStep": clean_flow_target_value(first_assignment(assignments, ["NEXT_STEP", "next_step"])),
        "scriptpoint": first_assignment(assignments, ["scriptpoint"]),
        "transferCode": clean_flow_target_value(first_assignment(assignments, ["TRANSFERCODE", "TransferCode", "transferCode", "transfercode"])),
        "mapaDna": first_assignment(assignments, ["MAPA_DNA", "mapa_dna"]),
        "skillId": clean_flow_target_value(first_assignment(assignments, ["SKILL_ID", "SkillID", "skillId", "skill_id"])),
        "skillName": clean_flow_target_value(first_assignment(assignments, ["SKILL_NAME", "SkillName", "skillName", "skill_name"])),
    }


def classify_doc_type(atype: str, caption: str, code: str, output: Dict[str, str]) -> str:
    text = f"{caption}\n{code}".lower()
    if atype == "BEGIN":
        return "start"
    if atype == "MENU":
        return "menu"
    if atype == "CASE":
        return "optionHub"
    if atype == "IF" or re.search(r"\bif\b", code, re.IGNORECASE):
        return "rule"
    if atype in {"RUNSUB", "REST_API", "WORKFLOWDATA"}:
        return "api"
    if atype in {"RUNSCRIPT", "RETURN", "PLAY"}:
        return "output"
    if atype == "ONRELEASE":
        return "onrelease"
    if "sil" in text or "timeout" in text:
        return "silence"
    if "rej" in text or "erro" in text or "error" in text:
        return "reject"
    if output.get("nextStep") or output.get("audio") or output.get("transferCode"):
        return "output"
    if re.search(r"\bswitch\b", code, re.IGNORECASE):
        return "optionHub"
    return "action"


def menu_variable(params: Any) -> str:
    if isinstance(params, dict):
        return clean_text(find_first(params, ("Variable", "MenuVariable", "ResultVariable")))
    if isinstance(params, list) and len(params) > 7:
        return clean_text(params[7])
    return ""


def extract_target(value: Dict[str, Any]) -> str:
    return clean_target(
        find_first(
            value,
            (
                "NextAction",
                "NextActionID",
                "NextActionId",
                "Target",
                "TargetAction",
                "TargetActionID",
                "TargetActionId",
                "GotoAction",
                "ActionID",
                "ActionId",
                "Next",
            ),
        )
    )


def normalize_branches(action: Dict[str, Any]) -> List[Dict[str, Any]]:
    if action.get("_niceTyped"):
        normalized = []
        for branch in as_list(action.get("Branches")):
            if not isinstance(branch, dict):
                continue
            target = clean_target(branch)
            if not target:
                continue
            normalized.append(
                {
                    "name": clean_text(branch.get("text") or branch.get("keyName") or f"Branch {branch.get('index', '')}") or "branch",
                    "target": target,
                    "index": clean_text(branch.get("index")),
                    "segments": branch.get("segments") or [],
                    "raw": branch,
                }
            )
        return normalized
    branches = collect_named_dicts(action, ("Branch", "Branches", "ElseBranch"))
    normalized = []
    for branch in branches:
        target = extract_target(branch)
        if not target:
            continue
        normalized.append(
            {
                "name": clean_text(find_first(branch, ("Name", "Caption", "Label", "Condition", "Value"))) or "branch",
                "target": target,
                "raw": branch,
            }
        )
    return normalized


def normalize_cases(action: Dict[str, Any]) -> List[Dict[str, Any]]:
    if action.get("_niceTyped"):
        normalized = []
        for case in as_list(action.get("Cases")):
            if not isinstance(case, dict):
                continue
            target = clean_target(case)
            if not target:
                continue
            normalized.append(
                {
                    "value": clean_text(case.get("text") or case.get("keyName") or case.get("index")),
                    "target": target,
                    "index": clean_text(case.get("index")),
                    "segments": case.get("segments") or [],
                    "raw": case,
                }
            )
        return normalized
    cases = collect_named_dicts(action, ("Case", "Cases", "MenuCase", "Option"))
    normalized = []
    for case in cases:
        target = extract_target(case)
        if not target:
            continue
        normalized.append(
            {
                "value": clean_text(find_first(case, ("Value", "Digit", "Case", "Dtmf", "Option", "Name", "Label"))),
                "target": target,
                "raw": case,
            }
        )
    return normalized


def extract_prompts_from_action(action: Dict[str, Any], normalized_action: Dict[str, Any]) -> List[Dict[str, Any]]:
    text = stringify_parameters(action)
    prompts = []
    for match in WAV_RE.finditer(text):
        full_path = match.group("path").strip(" '\"")
        file_name = re.split(r"[\\\\/]", full_path)[-1]
        variable = ""
        before = text[max(0, match.start() - 80) : match.start()]
        var_match = re.search(r"([A-Za-z_][A-Za-z0-9_]*)['\"]?\s*[:=]\s*['\"]?$", before)
        if var_match:
            variable = var_match.group(1)
        usage = "menu" if normalized_action["type"] == "MENU" or "menu" in variable.lower() else "prompt"
        prompts.append(
            {
                "id": "",
                "fileName": file_name,
                "fullPath": full_path,
                "sourceActionId": normalized_action["actionId"],
                "sourceActionCaption": normalized_action["caption"],
                "sourceVariable": variable,
                "usageType": usage,
                "matchedAudio": False,
                "transcription": "",
                "aiCleanTranscript": "",
                "aiIntent": "",
                "aiMenuOptions": [],
            }
        )
    return prompts


def extract_edges(action: Dict[str, Any], normalized_action: Dict[str, Any]) -> List[Dict[str, Any]]:
    edges = []
    source = normalized_action["actionId"]
    default_next = clean_target(find_first(action, ("DefaultNextAction", "DefaultNextActionID", "DefaultNextActionId")))
    if default_next:
        edges.append({"source": source, "target": default_next, "label": "default", "kind": "default"})
    branches = normalized_action.get("branches") or normalize_branches(action)
    for branch in branches:
        if not isinstance(branch, dict):
            continue
        target = clean_target(branch.get("target") or extract_target(branch))
        if target:
            edges.append(
                {
                    "source": source,
                    "target": target,
                    "label": clean_text(branch.get("name") or find_first(branch, ("Name", "Caption", "Condition", "Value")) or "branch"),
                    "kind": "branch",
                }
            )
    cases = normalized_action.get("cases") or normalize_cases(action)
    for case in cases:
        if not isinstance(case, dict):
            continue
        target = clean_target(case.get("target") or extract_target(case))
        digit = clean_text(case.get("value") or find_first(case, ("Value", "Digit", "Case", "Dtmf", "Option")))
        if target:
            edges.append({"source": source, "target": target, "label": digit or "case", "kind": "case"})
    return edges


def extract_skills(action: Dict[str, Any], normalized_action: Dict[str, Any]) -> List[Dict[str, Any]]:
    text = stringify_parameters(action)
    skills = []
    for key in ("Skill", "SkillID", "SKILL_ID", "skillId", "skill_id"):
        value = find_first(action, (key,))
        if value:
            skills.append(
                {
                    "id": clean_text(value),
                    "name": clean_text(find_first(action, ("SkillName", "skillName")) or value),
                    "sourceActionId": normalized_action["actionId"],
                    "sourceActionCaption": normalized_action["caption"],
                }
            )
    for match in re.finditer(r"\bSKILL_ID\b\s*[:=]\s*['\"]?([A-Za-z0-9_-]+)", text, re.IGNORECASE):
        skills.append(
            {
                "id": match.group(1),
                "name": match.group(1),
                "sourceActionId": normalized_action["actionId"],
                "sourceActionCaption": normalized_action["caption"],
                "confidence": "explicit",
            }
        )
    pending_id = ""
    for match in re.finditer(
        r"\bASSIGN\s+(SKILL_ID|SKILL_NAME)\s*=\s*(\"[^\"]*\"|'[^']*'|[^\r\n{}]+)",
        action_code(action),
        re.IGNORECASE,
    ):
        key = match.group(1).upper()
        value = clean_assignment_value(match.group(2))
        if key == "SKILL_ID":
            pending_id = value
            continue
        if key == "SKILL_NAME":
            skill_id = pending_id or value
            skills.append(
                {
                    "id": skill_id,
                    "name": value,
                    "sourceActionId": normalized_action["actionId"],
                    "sourceActionCaption": normalized_action["caption"],
                    "confidence": "explicit",
                }
            )
            pending_id = ""
    return skills


def normalize_flow(payload: Any, file_name: str) -> Dict[str, Any]:
    source_actions = find_actions(payload)
    actions = []
    edges = []
    prompts = []
    skills = []
    variables = set()
    menus = []
    events = []
    timeouts = []
    validations = []
    transfer_codes = []

    for index, source in enumerate(source_actions):
        aid = action_id(source, index)
        atype = action_type(source)
        caption = action_caption(source)
        params = to_simple_parameters(source)
        branches = normalize_branches(source)
        cases = normalize_cases(source)
        default_next = clean_target(find_first(source, ("DefaultNextAction", "DefaultNextActionID", "DefaultNextActionId")))
        code = action_code(source)
        output = summarize_action_output(source)
        doc_type = classify_doc_type(atype, caption, code, output)
        normalized = {
            "actionId": aid,
            "type": atype,
            "caption": caption,
            "parameters": params,
            "branches": branches,
            "cases": cases,
            "defaultNextAction": default_next,
            "x": first_number(source, ("X", "x", "Left", "left")),
            "y": first_number(source, ("Y", "y", "Top", "top")),
            "libraryId": clean_text(find_first(source, ("LibraryID", "LibraryId", "libraryId"))),
            "snippets": [],
            "variables": [],
            "prompts": [],
            "skills": [],
            "docType": doc_type,
            "outputs": output,
            "audio": output.get("audio", ""),
            "nextStep": output.get("nextStep", ""),
            "scriptpoint": output.get("scriptpoint", ""),
            "transferCode": output.get("transferCode", ""),
            "mapaDna": output.get("mapaDna", ""),
            "raw": source,
        }

        text = stringify_parameters(source)
        if atype == "SNIPPET" or "snippet" in text.lower():
            normalized["snippets"].append(code[:4000] or text[:4000])
        if atype == "MENU":
            menus.append(
                {
                    "actionId": aid,
                    "caption": caption,
                    "variable": menu_variable(params),
                    "cases": normalized["cases"],
                    "prompt": params[0] if isinstance(params, list) and params else "",
                    "timeout": params[5] if isinstance(params, list) and len(params) > 5 else "",
                    "interdigit": params[6] if isinstance(params, list) and len(params) > 6 else "",
                }
            )
        if "timeout" in text.lower():
            timeouts.append({"actionId": aid, "caption": caption, "evidence": f"ActionID {aid}"})
        if "onanswer" in text.lower() or "onrelease" in text.lower():
            events.append({"actionId": aid, "caption": caption, "type": atype, "evidence": f"ActionID {aid}"})
        if doc_type == "rule" or atype in {"IF", "VALIDATE", "VALIDATION"}:
            validations.append({"actionId": aid, "caption": caption, "type": atype, "expression": code[:500]})

        assignment_names = set(parse_assignments(code).keys())
        brace_variables = set(re.findall(r"\{([A-Za-z_][A-Za-z0-9_:]*)\}", code))
        for variable in set(VAR_RE.findall(text)) | assignment_names | brace_variables:
            if (
                variable.upper() in {"MRES", "MRES1", "MRES2", "DNIS", "ANI", "SKILL_ID", "NEXT_STEP", "AUDIO"}
                or variable.lower().startswith("audio")
                or variable.startswith("global:")
                or variable in assignment_names
                or variable in brace_variables
            ):
                variables.add(variable)
                normalized["variables"].append(variable)

        action_prompts = extract_prompts_from_action(source, normalized)
        normalized["prompts"] = [item["fileName"] for item in action_prompts]
        action_skills = extract_skills(source, normalized)
        if output.get("transferCode"):
            transfer = {
                "id": output["transferCode"],
                "name": output["transferCode"],
                "sourceActionId": aid,
                "sourceActionCaption": caption,
                "kind": "transferCode",
                "nextStep": output.get("nextStep", ""),
            }
            transfer_codes.append(transfer)
            action_skills.append(transfer)
        if output.get("skillId"):
            skill = {
                "id": output["skillId"],
                "name": output.get("skillName") or output["skillId"],
                "sourceActionId": aid,
                "sourceActionCaption": caption,
                "kind": "skill",
                "nextStep": output.get("nextStep", ""),
            }
            action_skills.append(skill)
        normalized["skills"] = [item["id"] for item in action_skills]
        prompts.extend(action_prompts)
        skills.extend(action_skills)
        edges.extend(extract_edges(source, normalized))
        actions.append(normalized)

    valid_action_ids = {clean_text(action.get("actionId")) for action in actions}
    edges = [edge for edge in edges if clean_target(edge.get("source")) in valid_action_ids and clean_target(edge.get("target")) in valid_action_ids]
    prompts = dedupe_prompts(prompts)
    for idx, prompt in enumerate(prompts, start=1):
        prompt["id"] = f"prompt_{idx:03d}"

    unique_skills = {}
    for skill in skills:
        skill_id = clean_text(skill.get("id"))
        if not skill_id:
            continue
        existing = unique_skills.get(skill_id)
        if not existing:
            unique_skills[skill_id] = skill
            continue
        existing_name = clean_text(existing.get("name"))
        candidate_name = clean_text(skill.get("name"))
        if candidate_name and (candidate_name != skill_id or existing_name == skill_id):
            existing.update({key: value for key, value in skill.items() if clean_text(value)})

    edges = dedupe_edges(edges)
    flow = {
        "project": extract_project(payload, file_name.rsplit(".", 1)[0]),
        "actions": actions,
        "edges": edges,
        "menus": menus,
        "skills": list(unique_skills.values()),
        "transferCodes": list({item["id"]: item for item in transfer_codes}.values()),
        "prompts": prompts,
        "cdrVariables": sorted(variables),
        "events": events,
        "timeouts": timeouts,
        "loops": detect_loops(edges),
        "validations": validations,
        "history": [
            {
                "step": "parse",
                "at": datetime.now(timezone.utc).isoformat(),
                "message": "Fluxo normalizado deterministicamente pelo parser Python.",
            }
        ],
    }
    validate_normalized_flow(flow, payload)
    return flow


def validate_normalized_flow(flow: Dict[str, Any], payload: Any) -> None:
    actions = [item for item in flow.get("actions", []) if isinstance(item, dict)]
    has_xml = isinstance(payload, dict) and payload.get("_sourceFormat") == "xml"
    real_actions = [
        action
        for action in actions
        if clean_text(action.get("actionId"))
        and (
            clean_text(action.get("type"))
            or clean_text(action.get("caption"))
            or action.get("parameters")
            or action.get("branches")
            or action.get("cases")
            or action.get("defaultNextAction")
            or action.get("prompts")
            or action.get("skills")
        )
    ]
    if not real_actions:
        message = (
            "Parser NICE nao encontrou actions reais no XML. "
            "Verifique se o arquivo exportado contem ActionID/Action/Caption ou compartilhe uma amostra do XML NICE para mapear a variante."
        )
        raise ValueError(message if has_xml else "Arquivo NICE nao contem actions reconheciveis.")


def validate_package_flow(flow: Dict[str, Any]) -> None:
    actions = [item for item in flow.get("actions", []) if isinstance(item, dict)]
    edges = [item for item in flow.get("edges", []) if isinstance(item, dict)]
    has_typed_source = any((action.get("raw") or {}).get("_tag") == "ActionStruct" for action in actions)
    has_empty_single_action = (
        len(actions) <= 1
        and not edges
        and not clean_text(actions[0].get("type") if actions else "")
        and not clean_text(actions[0].get("caption") if actions else "")
    )
    if has_empty_single_action or (has_typed_source and (len(actions) <= 1 or not edges)):
        raise HTTPException(
            status_code=422,
            detail="Parser NICE nao gerou fluxo navegavel. Reinicie o servico Python ou valide o XML enviado.",
        )


def detect_loops(edges: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    loops = []
    for edge in edges:
        if edge.get("source") == edge.get("target"):
            loops.append({"actionId": edge.get("source", ""), "type": "self_loop"})
    return loops


def dedupe_edges(edges: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    result = []
    for edge in edges:
        key = (
            clean_text(edge.get("source")),
            clean_text(edge.get("target")),
            clean_text(edge.get("label")),
            clean_text(edge.get("kind")),
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(edge)
    return result


def dedupe_prompts(prompts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    result = []
    for prompt in prompts:
        key = (
            clean_text(prompt.get("sourceActionId")),
            clean_text(prompt.get("fileName")).lower(),
            clean_text(prompt.get("fullPath")).lower(),
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(prompt)
    return result


def drawio_coord(value: Any, fallback: int) -> int:
    try:
        text = clean_text(value)
        if not text:
            return fallback
        return int(float(text.replace(",", ".")))
    except (TypeError, ValueError):
        return fallback


def csv_text(headers: List[str], rows: List[List[Any]]) -> str:
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(headers)
    for row in rows:
        writer.writerow(row)
    return output.getvalue()


DRAWIO_STYLES = {
    "title": "text;html=1;strokeColor=none;fillColor=none;fontSize=20;fontStyle=1;align=center;verticalAlign=middle;whiteSpace=wrap;",
    "subtitle": "text;html=1;strokeColor=none;fillColor=none;fontSize=12;align=center;verticalAlign=middle;whiteSpace=wrap;",
    "terminal_start": "ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontStyle=1;",
    "terminal_end": "ellipse;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;fontStyle=1;",
    "decision": "rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=12;",
    "process": "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;arcSize=12;fontSize=12;",
    "data": "shape=process;whiteSpace=wrap;html=1;backgroundOutline=1;fillColor=#e1d5e7;strokeColor=#9673a6;fontSize=12;",
    "transfer": "rounded=1;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;arcSize=12;fontSize=12;",
    "warning": "rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;arcSize=12;fontSize=12;",
    "error": "rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;arcSize=12;fontSize=12;",
    "note": "shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;darkOpacity=0.05;fillColor=#fff2cc;strokeColor=#d6b656;fontSize=11;",
    "lane_header": "rounded=1;whiteSpace=wrap;html=1;fillColor=#f4f4f5;strokeColor=#a1a1aa;fontStyle=1;fontSize=14;",
    "lane_header_claro": "rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;fontStyle=1;fontSize=14;",
    "lane_header_bcc": "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontStyle=1;fontSize=14;",
    "lane_header_hitss": "rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontStyle=1;fontSize=14;",
    "table_header": "rounded=0;whiteSpace=wrap;html=1;fillColor=#f4f4f5;strokeColor=#a1a1aa;fontStyle=1;fontSize=11;",
    "table_cell": "rounded=0;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#d4d4d8;fontSize=10;align=left;spacing=6;",
    "edge": "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;strokeWidth=1.2;",
    "technical": "rounded=1;whiteSpace=wrap;html=1;fillColor=#fff7ed;strokeColor=#ea580c;spacing=8;fontSize=11;",
}


def safe_drawio_id(value: Any) -> str:
    text = re.sub(r"[^A-Za-z0-9_]+", "_", clean_text(value))
    text = text.strip("_")
    return text or "item"


def mx_node(cell_id: str, label: str, x: int, y: int, width: int, height: int, style_key: str = "process") -> str:
    return (
        f'<mxCell id="{html.escape(cell_id)}" value="{html.escape(label)}" style="{DRAWIO_STYLES[style_key]}" vertex="1" parent="1">'
        f'<mxGeometry x="{x}" y="{y}" width="{width}" height="{height}" as="geometry" /></mxCell>'
    )


def mx_edge(edge_id: str, source: str, target: str, label: str = "") -> str:
    return (
        f'<mxCell id="{html.escape(edge_id)}" value="{html.escape(label)}" style="{DRAWIO_STYLES["edge"]}" edge="1" parent="1" '
        f'source="{html.escape(source)}" target="{html.escape(target)}"><mxGeometry relative="1" as="geometry" /></mxCell>'
    )


def mx_diagram(name: str, cells: List[str], width: int = 1800, height: int = 1400) -> str:
    model = (
        f'<mxGraphModel dx="1500" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" '
        f'fold="1" page="1" pageScale="1" pageWidth="{width}" pageHeight="{height}" math="0" shadow="0"><root>'
        '<mxCell id="0" /><mxCell id="1" parent="0" />'
        + "".join(cells)
        + "</root></mxGraphModel>"
    )
    return f'<diagram name="{html.escape(name)}">{model}</diagram>'


def action_by_id(flow: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {clean_text(action.get("actionId")): action for action in flow.get("actions", []) if isinstance(action, dict)}


def find_actions_by(flow: Dict[str, Any], predicate) -> List[Dict[str, Any]]:
    return [action for action in flow.get("actions", []) if isinstance(action, dict) and predicate(action)]


def short_label(value: Any, limit: int = 90) -> str:
    text = re.sub(r"\s+", " ", clean_text(value))
    return text if len(text) <= limit else text[: limit - 3] + "..."


def prompt_index_by_action(flow: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    index: Dict[str, List[Dict[str, Any]]] = {}
    for prompt in flow.get("prompts", []):
        if not isinstance(prompt, dict):
            continue
        aid = clean_text(prompt.get("sourceActionId"))
        if not aid:
            continue
        index.setdefault(aid, []).append(prompt)
    return index


def prompt_lines_for_action(action: Dict[str, Any], prompt_index: Dict[str, List[Dict[str, Any]]], max_prompts: int = 2) -> List[str]:
    prompts = prompt_index.get(clean_text(action.get("actionId")), [])
    lines: List[str] = []
    for prompt in prompts[:max_prompts]:
        file_name = clean_text(prompt.get("fileName") or prompt.get("audio") or prompt.get("fullPath"))
        spoken = clean_text(prompt.get("transcription") or prompt.get("rawTranscription"))
        if file_name:
            lines.append(f"Audio: {short_label(file_name, 55)}")
        if spoken:
            lines.append(f"Fala: {short_label(spoken, 150)}")
    return lines


def edge_label(edge: Dict[str, Any]) -> str:
    raw = clean_text(edge.get("label") or edge.get("name") or edge.get("kind"))
    low = raw.lower()
    if low in {"true", "verdadeiro"}:
        return "Sim"
    if low in {"false", "falso"}:
        return "Nao"
    if "timeout" in low:
        return "Timeout"
    if "sil" in low:
        return "Silencio"
    if "rej" in low or "invalid" in low or "inval" in low:
        return "Rejeicao"
    if raw in {"default", "Default"}:
        return "Default"
    return short_label(raw, 45)


def action_style(action: Dict[str, Any]) -> str:
    action_type = clean_text(action.get("type")).upper()
    doc_type = clean_text(action.get("docType")).lower()
    caption = clean_text(action.get("caption")).lower()
    if action_type == "BEGIN":
        return "terminal_start"
    if action_type == "END" or "desliga" in caption or "fim" in caption:
        return "terminal_end"
    if action_type in {"MENU", "IF", "HOURS", "SWITCH"} or doc_type == "rule":
        return "decision"
    if action_type == "REQAGENT" or action.get("transferCode") or action.get("skills"):
        return "transfer"
    if "timeout" in caption or "reject" in caption or "reje" in caption:
        return "warning"
    if action.get("cdrVariables"):
        return "data"
    return "process"


def action_label(action: Dict[str, Any], prompt_index: Dict[str, List[Dict[str, Any]]], compact: bool = False) -> str:
    aid = clean_text(action.get("actionId"))
    action_type = clean_text(action.get("type"))
    caption = clean_text(action.get("caption")) or f"Action {aid}"
    lines = [
        f"ActionID {aid}",
        f"{action_type} - {short_label(caption, 80)}",
    ]
    if action.get("docType"):
        lines.append(f"Funcao: {action.get('docType')}")
    lines.extend(prompt_lines_for_action(action, prompt_index, 1 if compact else 2))
    if action.get("audio") and not any(line.startswith("Audio:") for line in lines):
        lines.append(f"Audio: {short_label(action.get('audio'), 55)}")
    if action.get("nextStep"):
        lines.append(f"NEXT_STEP: {short_label(action.get('nextStep'), 60)}")
    if action.get("transferCode"):
        lines.append(f"TransferCode: {short_label(action.get('transferCode'), 60)}")
    if action.get("skills"):
        lines.append("Skill: " + short_label(", ".join(map(str, action.get("skills", [])[:3])), 80))
    if action.get("cases") and not compact:
        cases = ", ".join(
            f"{case.get('value') or case.get('name')}->{case.get('target')}"
            for case in action.get("cases", [])[:6]
        )
        if cases:
            lines.append("Opcoes: " + short_label(cases, 120))
    if action.get("branches") and not compact:
        branches = ", ".join(
            f"{branch.get('name') or branch.get('value')}->{branch.get('target')}"
            for branch in action.get("branches", [])[:4]
        )
        if branches:
            lines.append("Branches: " + short_label(branches, 120))
    return "\n".join(lines)


def company_for_action(action: Dict[str, Any]) -> str:
    text = " ".join(
        [
            clean_text(action.get("caption")),
            clean_text(action.get("audio")),
            clean_text(action.get("nextStep")),
            json.dumps(action.get("parameters", ""), ensure_ascii=False, default=str),
        ]
    ).lower()
    if "hitss" in text:
        return "HITSS"
    if "bcc" in text or "brasil center" in text:
        return "BCC"
    if "claro" in text:
        return "Claro"
    return ""


def build_navigation_maps(flow: Dict[str, Any]) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, List[Dict[str, Any]]], Dict[str, int]]:
    actions_map = action_by_id(flow)
    adjacency: Dict[str, List[Dict[str, Any]]] = {aid: [] for aid in actions_map}
    incoming: Dict[str, int] = {aid: 0 for aid in actions_map}
    for edge in flow.get("edges", []):
        source = clean_text(edge.get("source"))
        target = clean_text(edge.get("target"))
        if source not in actions_map or target not in actions_map:
            continue
        adjacency.setdefault(source, []).append(edge)
        incoming[target] = incoming.get(target, 0) + 1
    return actions_map, adjacency, incoming


def sort_action_id(value: Any) -> Tuple[int, str]:
    text = clean_text(value)
    try:
        return (int(text), text)
    except ValueError:
        return (10**9, text)


def navigation_order(flow: Dict[str, Any], allowed_ids: Optional[set] = None) -> Tuple[List[str], Dict[str, int]]:
    actions_map, adjacency, incoming = build_navigation_maps(flow)
    candidate_ids = set(allowed_ids or actions_map.keys())
    roots = [
        aid
        for aid, action in actions_map.items()
        if aid in candidate_ids and clean_text(action.get("type")).upper() == "BEGIN"
    ]
    if not roots:
        roots = [aid for aid in candidate_ids if incoming.get(aid, 0) == 0]
    if not roots and candidate_ids:
        roots = [sorted(candidate_ids, key=sort_action_id)[0]]
    roots = sorted(set(roots), key=sort_action_id)

    order: List[str] = []
    levels: Dict[str, int] = {}
    queue: List[Tuple[str, int]] = [(root, 0) for root in roots]
    visited = set()
    while queue:
        aid, level = queue.pop(0)
        if aid in visited or aid not in candidate_ids:
            continue
        visited.add(aid)
        order.append(aid)
        levels[aid] = min(level, levels.get(aid, level))
        for edge in adjacency.get(aid, []):
            target = clean_text(edge.get("target"))
            if target in candidate_ids and target not in visited:
                queue.append((target, level + 1))

    for aid in sorted(candidate_ids - visited, key=sort_action_id):
        order.append(aid)
        levels[aid] = max(levels.values(), default=0) + 1
    return order, levels


def build_navigation_page(
    flow: Dict[str, Any],
    name: str,
    allowed_ids: Optional[set] = None,
    title: Optional[str] = None,
    subtitle: Optional[str] = None,
    max_nodes: int = 240,
) -> str:
    actions_map, adjacency, _incoming = build_navigation_maps(flow)
    prompt_index = prompt_index_by_action(flow)
    order, levels = navigation_order(flow, allowed_ids)
    if max_nodes and len(order) > max_nodes:
        order = order[:max_nodes]
    visible = set(order)
    level_rows: Dict[int, int] = {}
    cells = [
        mx_node(f"{safe_drawio_id(name)}_title", title or name, 360, 20, 980, 40, "title"),
        mx_node(
            f"{safe_drawio_id(name)}_sub",
            subtitle or "Navegacao gerada deterministicamente do XML NICE. Falas aparecem quando o audio foi transcrito.",
            320,
            58,
            1100,
            34,
            "subtitle",
        ),
    ]

    for aid in order:
        action = actions_map[aid]
        level = levels.get(aid, 0)
        row = level_rows.get(level, 0)
        level_rows[level] = row + 1
        x = 70 + level * 315
        y = 125 + row * 185
        height = 145 if prompt_lines_for_action(action, prompt_index) else 118
        cells.append(
            mx_node(
                f"nav_{safe_drawio_id(name)}_{safe_drawio_id(aid)}",
                action_label(action, prompt_index, compact=False),
                x,
                y,
                270,
                height,
                action_style(action),
            )
        )

    edge_index = 0
    for aid in order:
        for edge in adjacency.get(aid, []):
            target = clean_text(edge.get("target"))
            if target not in visible:
                continue
            edge_index += 1
            source_id = f"nav_{safe_drawio_id(name)}_{safe_drawio_id(aid)}"
            target_id = f"nav_{safe_drawio_id(name)}_{safe_drawio_id(target)}"
            label = edge_label(edge)
            if levels.get(target, 0) <= levels.get(aid, 0):
                label = short_label(f"{label} / retorno" if label else "retorno", 45)
            cells.append(mx_edge(f"nav_{safe_drawio_id(name)}_e{edge_index}", source_id, target_id, label))

    if not order:
        cells.append(mx_node(f"{safe_drawio_id(name)}_empty", "Nenhuma action navegavel encontrada.", 420, 180, 420, 90, "warning"))

    width = max(1600, 160 + (max(levels.values(), default=0) + 1) * 315)
    height = max(1000, 220 + (max(level_rows.values(), default=1)) * 185)
    return mx_diagram(name, cells, width, height)


def build_main_flow_page(flow: Dict[str, Any]) -> str:
    return build_navigation_page(
        flow,
        "Fluxo Principal",
        title=f"Fluxograma {flow.get('project', {}).get('name', 'URA')} - navegacao completa",
        subtitle="Fluxo funcional completo gerado do XML NICE. A IA nao cria conexoes; ela apenas contextualiza textos.",
    )


def build_company_flow_pages(flow: Dict[str, Any]) -> List[str]:
    actions_map, adjacency, _incoming = build_navigation_maps(flow)
    pages: List[str] = []
    for company in ["Claro", "BCC", "HITSS"]:
        base_ids = {aid for aid, action in actions_map.items() if company_for_action(action) == company}
        if not base_ids:
            continue
        expanded = set(base_ids)
        for aid, edges in adjacency.items():
            if aid in base_ids:
                expanded.update(clean_text(edge.get("target")) for edge in edges)
            if any(clean_text(edge.get("target")) in base_ids for edge in edges):
                expanded.add(aid)
        expanded = {aid for aid in expanded if aid in actions_map}
        pages.append(
            build_navigation_page(
                flow,
                f"Fluxo {company}",
                allowed_ids=expanded,
                title=f"Fluxo {company}",
                subtitle=f"Recorte navegavel das actions relacionadas a {company}, com entradas, saidas e retornos.",
                max_nodes=120,
            )
        )
    return pages


def action_ref(action: Optional[Dict[str, Any]]) -> str:
    if not action:
        return "ActionID N/D"
    return f"ActionID {action.get('actionId', 'N/D')}"


def find_action(flow: Dict[str, Any], action_id: str) -> Optional[Dict[str, Any]]:
    return action_by_id(flow).get(clean_text(action_id))


def find_first_action(
    flow: Dict[str, Any],
    action_type: Optional[str] = None,
    caption_contains: Optional[str] = None,
    company: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    wanted_type = clean_text(action_type).upper()
    wanted_caption = clean_text(caption_contains).lower()
    for action in flow.get("actions", []):
        if not isinstance(action, dict):
            continue
        if wanted_type and clean_text(action.get("type")).upper() != wanted_type:
            continue
        if wanted_caption and wanted_caption not in clean_text(action.get("caption")).lower():
            continue
        if company and company_for_action(action) != company:
            continue
        return action
    return None


def actions_for_company(flow: Dict[str, Any], company: str) -> List[Dict[str, Any]]:
    return [action for action in flow.get("actions", []) if isinstance(action, dict) and company_for_action(action) == company]


def menus_for_company(flow: Dict[str, Any], company: str) -> List[Dict[str, Any]]:
    company_menus = [action for action in actions_for_company(flow, company) if clean_text(action.get("type")).upper() == "MENU"]
    if company_menus:
        return company_menus
    captions = {
        "Claro": ["ALO_RH_CLARO"],
        "BCC": ["ALO_RH_BCC"],
        "HITSS": ["ALO_RH_HITSS"],
    }
    result = []
    for caption in captions.get(company, []):
        found = find_first_action(flow, "MENU", caption)
        if found:
            result.append(found)
    return result


def company_skills(flow: Dict[str, Any], company: str) -> List[Dict[str, Any]]:
    prefix = f"{company}.".upper()
    result = []
    for skill in flow.get("skills", []):
        text = " ".join(
            [
                clean_text(skill.get("name")),
                clean_text(skill.get("sourceActionCaption")),
                clean_text(skill.get("nextStep")),
            ]
        ).upper()
        if prefix in text or company.upper() in text:
            result.append(skill)
    return result


SUBJECT_REPLACEMENTS = {
    "AUX CRECHE": "Auxilio Creche",
    "AUXILIOCRECHE": "Auxilio Creche",
    "AUXILIO CRECHE": "Auxilio Creche",
    "VALE TRANSPORTE": "Vale Transporte",
    "VALETRANSPORTE": "Vale Transporte",
    "ASSIST MEDICA": "Assistencia Medica",
    "ASSISTENCIA MEDICA": "Assistencia Medica",
    "ASSISTMEDICA": "Assistencia Medica",
    "ASSIST ODONTO": "Assistencia Odontologica",
    "ASSIST ODONTOLOGICA": "Assistencia Odontologica",
    "ASSISTENCIA ODONTOLOGICA": "Assistencia Odontologica",
    "ODONTO": "Assistencia Odontologica",
    "SEGURO VIDA": "Seguro de Vida",
    "SEGUROVIDA": "Seguro de Vida",
    "EMPRES CONSIG": "Emprestimo Consignado",
    "EMPRESTIMO CONSIGNADO": "Emprestimo Consignado",
    "CONSIG": "Emprestimo Consignado",
    "PONTO": "Ponto",
    "AFASTAMENTO": "Afastamento",
    "FERIAS": "Ferias",
    "FOLHA PGTO": "Folha de Pagamento",
    "FOLHA PAGAMENTO": "Folha de Pagamento",
    "DESLIGADOS": "Desligados",
    "DEMAIS ASSUNTOS": "Demais Assuntos RH",
    "ATEND LIDER": "Atendimento ao Lider",
    "ATENDIMENTO LIDER": "Atendimento ao Lider",
    "ADMISSAO": "Admissao",
    "ALELO": "Alelo",
    "BENEFICIOS": "Beneficios",
}


CATEGORY_ORDER = [
    "Beneficios",
    "Ponto",
    "Afastamento",
    "Folha de Pagamento",
    "Desligados",
    "Ferias",
    "Demais Assuntos RH",
    "Atendimento ao Lider",
    "Admissao",
    "Emprestimo Consignado",
]


def normalize_human_text(value: Any) -> str:
    text = clean_text(value)
    text = re.sub(r"[_./\\-]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return ""
    upper = text.upper()
    for key, replacement in SUBJECT_REPLACEMENTS.items():
        if upper == key or key in upper:
            return replacement
    return text.title()


def subject_from_skill_name(name: Any) -> str:
    text = clean_text(name)
    if not text:
        return ""
    tail = text.split(".")[-1]
    return normalize_human_text(tail)


def company_from_text(value: Any) -> str:
    text = clean_text(value).upper()
    if "HITSS" in text:
        return "HITSS"
    if "BCC" in text or "BRASIL CENTER" in text:
        return "BCC"
    if "CLARO" in text:
        return "Claro"
    return ""


def category_for_subject(subject: Any) -> str:
    text = normalize_human_text(subject)
    upper = text.upper()
    if upper in {"AUXILIO CRECHE", "VALE TRANSPORTE", "ASSISTENCIA MEDICA", "ASSISTENCIA ODONTOLOGICA", "SEGURO DE VIDA", "ALELO"}:
        return "Beneficios"
    for category in CATEGORY_ORDER:
        if category.upper() in upper or upper in category.upper():
            return category
    return text or "Categoria nao identificada"


def audio_subject_from_path(path: Any) -> str:
    text = clean_text(path)
    if not text:
        return ""
    file_name = re.split(r"[\\/]", text)[-1]
    stem = re.sub(r"\.wav$", "", file_name, flags=re.IGNORECASE)
    stem = re.sub(r"^(ura_)?alo_?rh_", "", stem, flags=re.IGNORECASE)
    stem = re.sub(r"^(claro|bcc|hitss)_", "", stem, flags=re.IGNORECASE)
    stem = re.sub(r"^(aviso|menu|combo|colaborador)_", "", stem, flags=re.IGNORECASE)
    return normalize_human_text(stem)


def iter_action_audio_paths(action: Dict[str, Any]) -> List[str]:
    text = action_code(action)
    paths = []
    for match in WAV_RE.finditer(text):
        paths.append(match.group("path").strip(" '\""))
    for prompt in as_list(action.get("prompts")):
        if clean_text(prompt).lower().endswith(".wav"):
            paths.append(clean_text(prompt))
    if action.get("audio"):
        paths.append(clean_text(action.get("audio")))
    return paths


def action_company_context(flow: Dict[str, Any], action: Dict[str, Any]) -> str:
    direct = company_for_action(action)
    if direct:
        return direct
    text = " ".join([clean_text(action.get("caption")), action_code(action)])
    return company_from_text(text)


def deterministic_route_rows(flow: Dict[str, Any], company: str) -> List[Dict[str, Any]]:
    prompt_index = prompt_index_by_action(flow)
    rows: List[Dict[str, Any]] = []
    seen = set()

    def add_row(category: str, treatment: str, action: Optional[Dict[str, Any]], skill: Optional[Dict[str, Any]] = None, confidence: str = "deterministic") -> None:
        category = category_for_subject(category or treatment)
        treatment = normalize_human_text(treatment or category)
        action_id_value = clean_text((skill or {}).get("sourceActionId") or (action or {}).get("actionId"))
        key = (company, category.lower(), treatment.lower(), clean_text((skill or {}).get("id")), action_id_value)
        if key in seen or not category:
            return
        seen.add(key)
        rows.append(
            {
                "company": company,
                "category": category,
                "treatment": treatment,
                "actionId": action_id_value,
                "skillId": clean_text((skill or {}).get("id")),
                "skillName": clean_text((skill or {}).get("name")),
                "audioText": action_audio_text(action, prompt_index, 150) if action else "",
                "confidence": confidence,
            }
        )

    for skill in company_skills(flow, company):
        action = find_action(flow, clean_text(skill.get("sourceActionId")))
        subject = subject_from_skill_name(skill.get("name")) or skill_subject(skill)
        add_row(category_for_subject(subject), subject, action, skill, clean_text(skill.get("confidence") or "explicit"))

    for action in flow.get("actions", []):
        if not isinstance(action, dict):
            continue
        action_text = " ".join([clean_text(action.get("caption")), action_code(action)])
        action_company = action_company_context(flow, action)
        if action_company and action_company != company:
            continue
        if not action_company and company.upper() not in action_text.upper():
            continue
        assignments = parse_assignments(action_code(action))
        assunto = first_assignment(assignments, ["Assunto", "assunto"])
        if assunto:
            add_row(assunto, assunto, action, None, "inferred")
        for path in iter_action_audio_paths(action):
            path_company = company_from_text(path)
            if path_company and path_company != company:
                continue
            subject = audio_subject_from_path(path)
            if subject and subject.upper() not in {"TCHAU", "CLAROHOLD", "BIP"}:
                add_row(category_for_subject(subject), subject, action, None, "inferred")

    rows.sort(
        key=lambda row: (
            CATEGORY_ORDER.index(row["category"]) if row["category"] in CATEGORY_ORDER else 999,
            row["treatment"],
            sort_action_id(row["actionId"]),
        )
    )
    return rows


def skill_subject(skill: Dict[str, Any]) -> str:
    name = clean_text(skill.get("name"))
    if "." in name:
        return subject_from_skill_name(name)
    return clean_text(skill.get("sourceActionCaption")) or clean_text(skill.get("id"))


def action_audio_text(action: Optional[Dict[str, Any]], prompt_index: Dict[str, List[Dict[str, Any]]], limit: int = 70) -> str:
    if not action:
        return ""
    lines = prompt_lines_for_action(action, prompt_index, 1)
    if lines:
        return "\n".join(short_label(line, limit) for line in lines[:2])
    if action.get("prompts"):
        return "Audio: " + short_label(", ".join(map(str, action.get("prompts", [])[:2])), limit)
    if action.get("audio"):
        return "Audio: " + short_label(action.get("audio"), limit)
    return ""


def menu_options_label(action: Optional[Dict[str, Any]], fallback: str = "") -> str:
    if not action:
        return fallback
    cases = action.get("cases") or []
    if cases:
        return "\n".join(
            f"{case.get('value') or case.get('name')} -> ActionID {case.get('target')}"
            for case in cases[:6]
        )
    return fallback


def company_menu_summary(flow: Dict[str, Any], company: str) -> str:
    menus = menus_for_company(flow, company)
    skills = company_skills(flow, company)
    main = menus[0] if menus else None
    subjects = ", ".join(skill_subject(skill) for skill in skills[:4])
    count_text = f"Categorias 1-{max(len(skills), 1)}" if skills else "Categorias"
    return "\n".join(
        [
            f"{main.get('caption') if main else company}",
            count_text,
            action_ref(main),
            short_label(subjects, 55) if subjects else "Roteamento por menus/snippets",
        ]
    )


def lane_ids(company: str) -> Dict[str, str]:
    prefix = safe_drawio_id(company).upper()
    return {
        "hdr": f"{prefix}_HDR",
        "hours": f"{prefix}_HOURS",
        "closed": f"{prefix}_FECH",
        "end": f"{prefix}_END",
        "menu0": f"{prefix}_MENU0",
        "audio1": f"{prefix}_AUDIO1",
        "aviso1": f"{prefix}_AVISO1",
        "menu1": f"{prefix}_MENU1",
        "rule1": f"{prefix}_RULE1",
        "aviso2": f"{prefix}_AVISO2",
        "transfer_decision": f"{prefix}_TDEC",
        "menu2": f"{prefix}_MENU2",
        "rule2": f"{prefix}_RULE2",
        "req": f"{prefix}_REQ",
    }


def build_company_lane(
    flow: Dict[str, Any],
    prompt_index: Dict[str, List[Dict[str, Any]]],
    company: str,
    x: int,
    header_style: str,
) -> Tuple[List[str], List[str]]:
    menus = menus_for_company(flow, company)
    skills = company_skills(flow, company)
    main_menu = menus[0] if menus else None
    ids = lane_ids(company)
    cells = [
        mx_node(ids["hdr"], company.upper(), x - 20, 1080, 340, 40, header_style),
        mx_node(ids["hours"], "Horario/feriado\nvalida expediente", x + 65, 1150, 150, 70, "decision"),
        mx_node(ids["closed"], "Audio fechado\nou feriado", x + 240, 1155, 150, 60, "warning"),
        mx_node(ids["end"], "Fim", x + 275, 1245, 90, 45, "terminal_end"),
        mx_node(ids["menu0"], company_menu_summary(flow, company), x + 40, 1260, 200, 90, "decision"),
        mx_node(
            ids["audio1"],
            "Define audio_menu1\n" + short_label(action_audio_text(main_menu, prompt_index) or "audio de aviso", 80),
            x + 40,
            1375,
            200,
            70,
            "process",
        ),
        mx_node(ids["aviso1"], "Play aviso\nquando aplicavel", x + 40, 1470, 200, 50, "warning"),
        mx_node(ids["menu1"], f"Menu 1\nMRES1 / mres1\n{action_ref(menus[1] if len(menus) > 1 else main_menu)}", x + 40, 1545, 200, 75, "decision"),
        mx_node(
            ids["rule1"],
            "Define skill direta\nou menu_audio2\n"
            + short_label(", ".join(skill_subject(skill) for skill in skills[:2]) or "regras de roteamento", 60),
            x + 40,
            1650,
            200,
            72,
            "process",
        ),
        mx_node(ids["aviso2"], "Play aviso 2\nquando aplicavel", x + 40, 1745, 200, 50, "warning"),
        mx_node(ids["transfer_decision"], "Transfer_skill?", x + 65, 1820, 150, 70, "decision"),
    ]
    if company == "Claro":
        cells.extend(
            [
                mx_node(ids["menu2"], f"Menu 2\nMRES2 / mres2\n{action_ref(menus[2] if len(menus) > 2 else None)}", x + 40, 1935, 200, 75, "decision"),
                mx_node(ids["rule2"], "Define skill ou Menu 3\nAssistencia Medica", x + 40, 2040, 200, 70, "process"),
                mx_node(f"{ids['menu2']}_3", "Menu 3\nMRES3\nAssistencia Medica", x + 40, 2150, 200, 80, "decision"),
                mx_node(ids["req"], "REQAGENT Claro\nTransfere para {SKILL_ID}", x + 40, 2260, 200, 60, "transfer"),
            ]
        )
    else:
        cells.extend(
            [
                mx_node(ids["menu2"], f"Menu 2\nMRES2 / mres2\n{action_ref(menus[1] if len(menus) > 1 else None)}", x + 40, 1935, 200, 75, "decision"),
                mx_node(ids["rule2"], "Define skill\nde destino\n" + short_label(", ".join(skill_subject(skill) for skill in skills[:3]), 55), x + 40, 2040, 200, 65, "process"),
                mx_node(ids["req"], f"REQAGENT {company}\nTransfere para {{SKILL_ID}}", x + 40, 2135, 200, 60, "transfer"),
            ]
        )
    edges = [
        mx_edge(f"e_{ids['hdr']}_1", ids["hdr"], ids["hours"]),
        mx_edge(f"e_{ids['hdr']}_2", ids["hours"], ids["closed"], "Fechado"),
        mx_edge(f"e_{ids['hdr']}_3", ids["closed"], ids["end"]),
        mx_edge(f"e_{ids['hdr']}_4", ids["hours"], ids["menu0"], "Aberto"),
        mx_edge(f"e_{ids['hdr']}_5", ids["menu0"], ids["audio1"]),
        mx_edge(f"e_{ids['hdr']}_6", ids["audio1"], ids["aviso1"]),
        mx_edge(f"e_{ids['hdr']}_7", ids["aviso1"], ids["menu1"]),
        mx_edge(f"e_{ids['hdr']}_8", ids["menu1"], ids["rule1"]),
        mx_edge(f"e_{ids['hdr']}_9", ids["rule1"], ids["aviso2"]),
        mx_edge(f"e_{ids['hdr']}_10", ids["aviso2"], ids["transfer_decision"]),
        mx_edge(f"e_{ids['hdr']}_11", ids["transfer_decision"], ids["req"], "Sim"),
        mx_edge(f"e_{ids['hdr']}_12", ids["transfer_decision"], ids["menu2"], "Nao"),
        mx_edge(f"e_{ids['hdr']}_13", ids["menu2"], ids["rule2"]),
        mx_edge(f"e_{ids['hdr']}_14", ids["rule2"], ids["req"], "Transferir"),
    ]
    if company == "Claro":
        edges.append(mx_edge(f"e_{ids['hdr']}_15", ids["rule2"], f"{ids['menu2']}_3", "Menu 3"))
        edges.append(mx_edge(f"e_{ids['hdr']}_16", f"{ids['menu2']}_3", ids["req"]))
    return cells, edges


def build_human_main_flow_page(flow: Dict[str, Any], ai: Optional[Dict[str, Any]] = None) -> str:
    project = flow.get("project", {})
    prompt_index = prompt_index_by_action(flow)
    begin = find_first_action(flow, "BEGIN")
    blocked_if = find_first_action(flow, "IF")
    hours = find_first_action(flow, "HOURS")
    horario = find_first_action(flow, "SNIPPET", "Horario")
    valida_horario = find_first_action(flow, "IF", "Valida Horario")
    cdr = find_first_action(flow, "SNIPPET", "Dados_CDR")
    saudacao = find_first_action(flow, "MENU", "Saud")
    tchau = find_first_action(flow, "PLAY", "tchau")
    invalid = find_first_action(flow, "PLAY", "inv")
    cells = [
        mx_node("p1_title", f"Fluxograma {project.get('name', 'URA ALO RH')} - visao editavel", 300, 20, 900, 40, "title"),
        mx_node("p1_sub", "Origem: XML NICE Studio. Estrutura em blocos para facilitar manutencao no draw.io.", 300, 58, 900, 30, "subtitle"),
        mx_node("A", f"Inicio\n{action_ref(begin)}", 650, 110, 150, 50, "terminal_start"),
        mx_node("B", f"ANI bloqueado?\n{action_ref(blocked_if)}", 650, 190, 150, 80, "decision"),
        mx_node("C", f"Hours\nreuniao/emergencia\n{action_ref(hours)}", 650, 310, 150, 80, "decision"),
        mx_node("C1", "Play reuniao geral\nmeio-dia", 910, 310, 190, 60, "warning"),
        mx_node("Z", "Fim", 1160, 420, 120, 50, "terminal_end"),
        mx_node(
            "D",
            "Snippet Horario\nferiado, fim de semana,\nreunioes e fora horario\n" + action_ref(horario),
            610,
            440,
            230,
            90,
            "process",
        ),
        mx_node("E", f"URA indisponivel?\n{action_ref(valida_horario)}", 650, 570, 150, 80, "decision"),
        mx_node("E1", "Play audio de\nindisponibilidade", 910, 570, 190, 60, "warning"),
        mx_node("F", f"Dados_CDR\ninicializa variaveis e CDR\n{action_ref(cdr)}", 610, 700, 230, 70, "data"),
        mx_node("G", "Bem-vindo", 640, 810, 170, 50, "warning"),
        mx_node(
            "H",
            "MenuInicial\n1 Claro\n2 BCC\n3 HITSS\n"
            + action_ref(saudacao)
            + ("\n" + short_label(action_audio_text(saudacao, prompt_index), 80) if action_audio_text(saudacao, prompt_index) else ""),
            625,
            900,
            200,
            115,
            "decision",
        ),
        mx_node("J", "Loop MenuInicial\nate 2 tentativas", 350, 900, 180, 70, "decision"),
        mx_node("K", f"Tchau\n{action_ref(tchau)}", 350, 1020, 140, 50, "warning"),
        mx_node(
            "TIMEOUT_NOTE",
            "Tratamento de timeout nos menus internos:\nTimeout encaminha para LOOP. Conforme limite, retorna ao menu correspondente ou encerra.",
            60,
            980,
            300,
            75,
            "note",
        ),
        mx_node(
            "AFTER",
            "Apos REQAGENT:\nCountagents + ClaroHold\nOnAnswer: marca transferencia sucesso e grava CDR\nOnRelease: marca cliente desligou e grava CDR",
            1110,
            2020,
            300,
            150,
            "note",
        ),
    ]
    cells.extend(
        [
            mx_edge("p1_e1", "A", "B"),
            mx_edge("p1_e2", "B", "Z", "Sim"),
            mx_edge("p1_e3", "B", "C", "Nao"),
            mx_edge("p1_e4", "C", "C1", "Reuniao/emergencia"),
            mx_edge("p1_e5", "C1", "Z"),
            mx_edge("p1_e6", "C", "D", "Normal"),
            mx_edge("p1_e7", "D", "E"),
            mx_edge("p1_e8", "E", "E1", "Sim"),
            mx_edge("p1_e9", "E1", "Z"),
            mx_edge("p1_e10", "E", "F", "Nao"),
            mx_edge("p1_e11", "F", "G"),
            mx_edge("p1_e12", "G", "H"),
            mx_edge("p1_e13", "H", "J", "Timeout/invalido"),
            mx_edge("p1_e14", "J", "H", "Repete"),
            mx_edge("p1_e15", "J", "K", "Limite"),
            mx_edge("p1_e16", "K", "Z"),
        ]
    )
    lanes = [
        ("Claro", 100, "lane_header_claro", "1"),
        ("BCC", 540, "lane_header_bcc", "2"),
        ("HITSS", 980, "lane_header_hitss", "3"),
    ]
    for company, x, style, digit in lanes:
        lane_cells, lane_edges = build_company_lane(flow, prompt_index, company, x, style)
        cells.extend(lane_cells)
        cells.extend(lane_edges)
        cells.append(mx_edge(f"p1_menu_{safe_drawio_id(company)}", "H", lane_ids(company)["hdr"], digit))
        cells.append(mx_edge(f"p1_after_{safe_drawio_id(company)}", lane_ids(company)["req"], "AFTER", "Atendimento"))
    return mx_diagram("Fluxo Principal", cells, 1500, 2450)


def table_cell(cell_id: str, label: str, x: int, y: int, width: int, height: int, header: bool = False) -> str:
    return mx_node(cell_id, label, x, y, width, height, "table_header" if header else "table_cell")


def build_menu_table_page(flow: Dict[str, Any]) -> str:
    prompt_index = prompt_index_by_action(flow)
    cells = [
        mx_node("p2_title", "Mapa editavel dos menus por empresa", 200, 20, 900, 40, "title"),
    ]
    columns = [("DTMF", 70), ("Categoria", 210), ("Tratamento", 330), ("ActionID", 110), ("Audio/Fala", 390)]
    for company_index, company in enumerate(["Claro", "BCC", "HITSS"]):
        rows = deterministic_route_rows(flow, company)
        y = 100 + company_index * 530
        cells.append(mx_node(f"p2_group_{company}", company, 40, y, 1160, 36, "lane_header_claro" if company == "Claro" else "lane_header_bcc" if company == "BCC" else "lane_header_hitss"))
        x = 40
        for title, width in columns:
            cells.append(table_cell(f"p2_h_{company}_{safe_drawio_id(title)}", title, x, y + 46, width, 32, True))
            x += width
        menus = menus_for_company(flow, company)
        main_menu = menus[0] if menus else None
        if not rows:
            rows.append(
                {
                    "category": main_menu.get("caption") if main_menu else company,
                    "treatment": "Roteamento por menu/snippet",
                    "actionId": clean_text(main_menu.get("actionId") if main_menu else ""),
                    "audioText": action_audio_text(main_menu, prompt_index, 120),
                    "confidence": "deterministic",
                }
            )
        for row_index, row in enumerate(rows[:11]):
            x = 40
            row_y = y + 78 + row_index * 34
            row_values = [
                str(row_index + 1) if row.get("confidence") != "inferred" else f"{row_index + 1}*",
                row.get("category", ""),
                row.get("treatment", ""),
                row.get("actionId", ""),
                row.get("audioText", ""),
            ]
            for col_index, ((_, width), value) in enumerate(zip(columns, row_values)):
                cells.append(table_cell(f"p2_{company}_{row_index}_{col_index}", short_label(value, 120), x, row_y, width, 34))
                x += width
        cells.append(mx_node(f"p2_note_{company}", "* DTMF inferido pela ordem deterministica quando o XML nao explicita o digito nesta tabela.", 40, y + 78 + min(len(rows[:11]), 11) * 34 + 8, 760, 26, "subtitle"))
    return mx_diagram("Mapa de Menus", cells, 1300, 1760)


def build_skill_table_page(flow: Dict[str, Any]) -> str:
    cells = [
        mx_node("p3_title", "Mapa editavel de skills de destino por empresa", 430, 20, 900, 40, "title"),
    ]
    table_widths = [170, 115, 245, 80]
    headers = ["Ramo/Assunto", "Skill ID", "Skill Name", "ActionID"]
    max_rows = 0
    for company_index, company in enumerate(["Claro", "BCC", "HITSS"]):
        x0 = 40 + company_index * 610
        rows = [row for row in deterministic_route_rows(flow, company) if row.get("skillId") or row.get("skillName")]
        if not rows:
            rows = deterministic_route_rows(flow, company)[:8]
        max_rows = max(max_rows, len(rows[:18]))
        cells.append(mx_node(f"p3_group_{company}", company, x0, 90, 590, 34, "lane_header_claro" if company == "Claro" else "lane_header_bcc" if company == "BCC" else "lane_header_hitss"))
        x = x0
        for title, width in zip(headers, table_widths):
            cells.append(table_cell(f"p3_h_{company}_{safe_drawio_id(title)}", title, x, 134, width, 32, True))
            x += width
        for row_index, row in enumerate(rows[:18]):
            x = x0
            y = 166 + row_index * 34
            row_values = [
                row.get("treatment") or row.get("category"),
                row.get("skillId") or "-",
                row.get("skillName") or row.get("category"),
                row.get("actionId"),
            ]
            for col_index, (width, value) in enumerate(zip(table_widths, row_values)):
                cells.append(table_cell(f"p3_{company}_{row_index}_{col_index}", short_label(value, 110), x, y, width, 34))
                x += width
    return mx_diagram("Mapa de Skills", cells, 1900, max(900, 230 + max_rows * 34))


def build_main_flow_page(flow: Dict[str, Any], ai: Optional[Dict[str, Any]] = None) -> str:
    return build_human_main_flow_page(flow, ai or {})


TECHNICAL_GROUPS = [
    ("Entrada", "Tecnico - Entrada", "Entrada comum, horario, CDR e saudacao"),
    ("Coleta Dados", "Tecnico - Coleta Dados", "Captura e validacao de CPF/celular"),
    ("Claro", "Tecnico - Claro", "Navegacao e roteamento Claro"),
    ("BCC", "Tecnico - BCC", "Navegacao e roteamento BCC"),
    ("HITSS", "Tecnico - HITSS", "Navegacao e roteamento HITSS"),
    ("Atendimento", "Tecnico - Atendimento", "Transferencia, fila, eventos e CDR de atendimento"),
    ("Encerramento", "Tecnico - Encerramento", "Finalizacao, loops, tchau e scripts de desligamento"),
]


def technical_group_for_action(action: Dict[str, Any]) -> str:
    action_type_value = clean_text(action.get("type")).upper()
    caption = clean_text(action.get("caption"))
    text = " ".join(
        [
            caption,
            clean_text(action.get("audio")),
            clean_text(action.get("nextStep")),
            json.dumps(action.get("parameters", ""), ensure_ascii=False, default=str),
        ]
    )
    lower = text.lower()
    company = company_for_action(action) or company_from_text(text)
    if company:
        return company
    if action_type_value in {"REQAGENT", "COUNTAGENTS", "WAIT", "ONANSWER", "ONRELEASE", "WHISPER", "MESSAGES"}:
        return "Atendimento"
    if any(token in lower for token in ["cpf", "celcancel", "celular", "checkmobile", "collecnum", "digitacel"]):
        return "Coleta Dados"
    if action_type_value in {"END", "RUNSCRIPT"} or any(token in lower for token in ["tchau", "desliga", "maxsil", "maxinv", "menutimeout"]):
        return "Encerramento"
    if action_type_value in {"BEGIN", "HOURS"} or any(token in lower for token in ["dados_cdr", "horario", "sauda", "menuprincipal", "semexpediente"]):
        return "Entrada"
    if action_type_value == "LOOP":
        return "Encerramento"
    return "Entrada"


def technical_groups(flow: Dict[str, Any]) -> Dict[str, List[str]]:
    groups: Dict[str, List[str]] = {group_id: [] for group_id, _, _ in TECHNICAL_GROUPS}
    for action in flow.get("actions", []):
        if not isinstance(action, dict):
            continue
        group = technical_group_for_action(action)
        groups.setdefault(group, []).append(clean_text(action.get("actionId")))
    for group_id in list(groups):
        groups[group_id] = sorted([aid for aid in groups[group_id] if aid], key=sort_action_id)
    return groups


def technical_node_label(action: Dict[str, Any], prompt_index: Dict[str, List[Dict[str, Any]]], annotations: Dict[str, Dict[str, Any]]) -> str:
    aid = clean_text(action.get("actionId"))
    lines = [
        f"ID {aid} | {clean_text(action.get('type'))}",
        short_label(action.get("caption") or f"Action {aid}", 58),
    ]
    for prompt_line in prompt_lines_for_action(action, prompt_index, 1):
        lines.append(short_label(prompt_line, 68))
    if action.get("audio") and not any("Audio:" in line for line in lines):
        lines.append("Audio: " + short_label(action.get("audio"), 55))
    if action.get("nextStep"):
        lines.append("NEXT_STEP: " + short_label(action.get("nextStep"), 48))
    if action.get("transferCode"):
        lines.append("Transfer: " + short_label(action.get("transferCode"), 48))
    if action.get("skills"):
        lines.append("Skill: " + short_label(", ".join(map(str, action.get("skills", [])[:2])), 58))
    ann = annotations.get(aid, {})
    if ann.get("title"):
        lines.append("IA: " + short_label(ann.get("title"), 46))
    return "\n".join(lines)


def build_technical_index_page(page_defs: List[Dict[str, Any]]) -> str:
    cells = [
        mx_node("tech_index_title", "Acoes NICE completas - indice tecnico", 360, 30, 980, 44, "title"),
        mx_node("tech_index_sub", "O grafo completo foi dividido em paginas menores. Cada pagina mantem edges reais locais e referencias para continuacao em outro subfluxo.", 250, 78, 1200, 34, "subtitle"),
    ]
    for index, page_def in enumerate(page_defs):
        group_id = page_def["groupId"]
        row = index // 2
        col = index % 2
        x = 170 + col * 720
        y = 160 + row * 135
        count = len(page_def.get("actionIds", []))
        style = "lane_header_claro" if group_id == "Claro" else "lane_header_bcc" if group_id == "BCC" else "lane_header_hitss" if group_id == "HITSS" else "process"
        cells.append(
            mx_node(
                f"tech_index_{index}_{safe_drawio_id(page_def['pageName'])}",
                f"{page_def['pageName']}\n{page_def['description']}\n{count} actions",
                x,
                y,
                560,
                82,
                style,
            )
        )
    note_y = 170 + ((len(page_defs) + 1) // 2) * 135
    cells.append(mx_node("tech_index_note", "Observacao: os detalhes brutos de parametros/snippets continuam no normalized_flow.json. As paginas tecnicas mostram labels compactos para edicao visual.", 260, note_y, 1100, 70, "note"))
    return mx_diagram("Acoes NICE - Indice", cells, 1600, max(950, note_y + 180))


def build_technical_group_page(
    flow: Dict[str, Any],
    ai: Dict[str, Any],
    group_id: str,
    page_name: str,
    description: str,
    groups: Dict[str, List[str]],
    action_ids_override: Optional[List[str]] = None,
    target_page_lookup: Optional[Dict[str, str]] = None,
) -> str:
    annotations = {str(item.get("actionId")): item for item in ai.get("drawioAnnotations", []) if isinstance(item, dict)}
    prompt_index = prompt_index_by_action(flow)
    actions_map = action_by_id(flow)
    action_ids = [aid for aid in (action_ids_override or groups.get(group_id, [])) if aid in actions_map]
    visible = set(action_ids)
    cells = [
        mx_node(f"tech_{safe_drawio_id(group_id)}_title", page_name, 360, 25, 980, 42, "title"),
        mx_node(f"tech_{safe_drawio_id(group_id)}_sub", description, 300, 68, 1100, 30, "subtitle"),
    ]
    node_width = 250
    node_height = 88
    col_gap = 330
    row_gap = 128
    columns = 5
    positions: Dict[str, Tuple[int, int]] = {}
    for index, aid in enumerate(action_ids):
        row = index // columns
        col = index % columns
        x = 45 + col * col_gap
        y = 125 + row * row_gap
        positions[aid] = (x, y)
        action = actions_map[aid]
        cells.append(
            mx_node(
                f"tech_{safe_drawio_id(group_id)}_{safe_drawio_id(aid)}",
                technical_node_label(action, prompt_index, annotations),
                x,
                y,
                node_width,
                node_height,
                action_style(action) if action_style(action) != "technical" else "process",
            )
        )

    target_to_group: Dict[str, str] = {}
    for other_group, ids in groups.items():
        for aid in ids:
            target_to_group[aid] = other_group

    boundary_nodes: Dict[Tuple[str, str], str] = {}
    edge_count = 0
    for edge in flow.get("edges", []):
        source = clean_text(edge.get("source"))
        target = clean_text(edge.get("target"))
        if source not in visible:
            continue
        source_id = f"tech_{safe_drawio_id(group_id)}_{safe_drawio_id(source)}"
        label = edge_label(edge)
        if target in visible:
            edge_count += 1
            cells.append(
                mx_edge(
                    f"tech_{safe_drawio_id(group_id)}_e{edge_count}",
                    source_id,
                    f"tech_{safe_drawio_id(group_id)}_{safe_drawio_id(target)}",
                    label,
                )
            )
            continue
        target_group = (target_page_lookup or {}).get(target) or target_to_group.get(target, "outro fluxo")
        boundary_key = (target, target_group)
        if boundary_key not in boundary_nodes:
            boundary_id = f"tech_{safe_drawio_id(group_id)}_ref_{safe_drawio_id(target)}"
            boundary_nodes[boundary_key] = boundary_id
            ref_index = len(boundary_nodes) - 1
            ref_row = ref_index // 2
            ref_col = ref_index % 2
            x = 1120 + ref_col * 270
            y = 125 + (len(action_ids) // columns + 1) * row_gap + ref_row * 88
            target_action = actions_map.get(target, {})
            cells.append(
                mx_node(
                    boundary_id,
                    f"Continua em {target_group}\nActionID {target}\n{short_label(target_action.get('caption'), 48)}",
                    x,
                    y,
                    240,
                    64,
                    "note",
                )
            )
        edge_count += 1
        cells.append(mx_edge(f"tech_{safe_drawio_id(group_id)}_e{edge_count}", source_id, boundary_nodes[boundary_key], label))

    if not action_ids:
        cells.append(mx_node(f"tech_{safe_drawio_id(group_id)}_empty", "Nenhuma action classificada neste subfluxo.", 560, 180, 480, 80, "warning"))
    rows = max(1, (len(action_ids) + columns - 1) // columns)
    ref_rows = max(0, (len(boundary_nodes) + 1) // 2)
    height = max(900, 170 + rows * row_gap + ref_rows * 88 + 120)
    return mx_diagram(page_name, cells, 1800, height)


def build_technical_pages(flow: Dict[str, Any], ai: Dict[str, Any]) -> List[str]:
    groups = technical_groups(flow)
    page_defs: List[Dict[str, Any]] = []
    chunk_size = 28
    for group_id, page_name, description in TECHNICAL_GROUPS:
        ids = groups.get(group_id, [])
        chunks = [ids[index : index + chunk_size] for index in range(0, len(ids), chunk_size)] or [[]]
        for chunk_index, chunk in enumerate(chunks, start=1):
            chunked_name = page_name if len(chunks) == 1 else f"{page_name} {chunk_index}"
            chunked_description = description if len(chunks) == 1 else f"{description} - parte {chunk_index} de {len(chunks)}"
            page_defs.append(
                {
                    "groupId": group_id,
                    "pageName": chunked_name,
                    "description": chunked_description,
                    "actionIds": chunk,
                }
            )
    target_page_lookup: Dict[str, str] = {}
    for page_def in page_defs:
        for aid in page_def.get("actionIds", []):
            target_page_lookup[aid] = page_def["pageName"]
    pages = [build_technical_index_page(page_defs)]
    for page_def in page_defs:
        pages.append(
            build_technical_group_page(
                flow,
                ai,
                page_def["groupId"],
                page_def["pageName"],
                page_def["description"],
                groups,
                page_def["actionIds"],
                target_page_lookup,
            )
        )
    return pages


# Dynamic NICE draw.io builders.
# The previous ALO RH-specific view is intentionally bypassed below so any NICE XML
# can generate a humanized diagram from its own actions, edges and snippets.

def strip_code_comments(code: str) -> str:
    text = re.sub(r"//.*", "", clean_text(code))
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    return text


def parse_snippet_assignments_by_case(code: str) -> List[Dict[str, Any]]:
    text = strip_code_comments(code)
    case_pattern = re.compile(r"\bCASE\s+['\"]?([A-Za-z0-9_#.-]+)['\"]?", re.IGNORECASE)
    matches = list(case_pattern.finditer(text))
    if not matches:
        assignments = parse_assignments(text)
        return [{"caseValues": [], "assignments": assignments, "body": text}] if assignments else []
    entries: List[Dict[str, Any]] = []
    pending_cases: List[str] = []
    for index, match in enumerate(matches):
        pending_cases.append(match.group(1))
        next_start = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        body = text[match.end() : next_start]
        if "{" not in body and index + 1 < len(matches):
            continue
        assignments = parse_assignments(body)
        if not assignments and "ASSIGN" not in body.upper():
            continue
        entries.append({"caseValues": pending_cases[:], "assignments": assignments, "body": body})
        pending_cases = []
    return entries


def tokenize_snippet(code: str) -> List[str]:
    text = strip_code_comments(code)
    return re.findall(r'"[^"]*"|\'[^\']*\'|\{|\}|[A-Za-z_][\w:.-]*|[0-9]+|==|!=|<=|>=|[=(),;]', text)


def parse_assignments_in_block(code: str) -> Dict[str, str]:
    return parse_assignments(code)


def _case_range_label(values: List[str]) -> str:
    clean_values = [clean_text(value) for value in values if clean_text(value)]
    if not clean_values:
        return ""
    try:
        numbers = [int(value) for value in clean_values]
        if numbers == list(range(min(numbers), max(numbers) + 1)) and len(numbers) > 2:
            return f"{min(numbers)}-{max(numbers)}"
    except ValueError:
        pass
    return ",".join(clean_values)


def parse_switch_case_tree(code: str) -> List[Dict[str, Any]]:
    text = strip_code_comments(code)
    switch_match = re.search(r"\bSWITCH\s+([A-Za-z_][\w:.-]*)", text, re.IGNORECASE)
    switch_variable = clean_text(switch_match.group(1)) if switch_match else ""
    case_matches = list(re.finditer(r"\bCASE\s+['\"]?([^'\"\s{]+)['\"]?", text, re.IGNORECASE))
    if not case_matches:
        assignments = parse_assignments_in_block(text)
        return [
            {
                "switchVariable": switch_variable,
                "caseValues": [],
                "caseRangeLabel": "",
                "assignments": assignments,
                "body": text,
            }
        ] if assignments else []

    cases: List[Dict[str, Any]] = []
    pending_values: List[str] = []
    for index, match in enumerate(case_matches):
        value = clean_text(match.group(1))
        if value:
            pending_values.append(value)
        next_start = case_matches[index + 1].start() if index + 1 < len(case_matches) else len(text)
        body = text[match.end():next_start]
        assignments = parse_assignments_in_block(body)
        if not assignments and "ASSIGN" not in body.upper():
            continue
        values = pending_values[:]
        cases.append(
            {
                "switchVariable": switch_variable,
                "caseValues": values,
                "caseRangeLabel": _case_range_label(values),
                "assignments": assignments,
                "body": body,
            }
        )
        pending_values = []
    return cases


def assignment_value(assignments: Dict[str, str], names: List[str]) -> str:
    value = first_assignment(assignments, names)
    if value.startswith("{") and "}" in value:
        value = value.split("}", 1)[1]
    return value.strip()


def semantic_rows(flow: Dict[str, Any]) -> List[Dict[str, Any]]:
    prompt_index = prompt_index_by_action(flow)
    rows: List[Dict[str, Any]] = []
    seen = set()

    def add(row: Dict[str, Any]) -> None:
        key = (
            row.get("sourceActionId", ""),
            ",".join(row.get("caseValues", [])),
            row.get("kind", ""),
            row.get("skillId", ""),
            row.get("skillName", ""),
            row.get("nextStep", ""),
            row.get("audio", ""),
        )
        if key in seen:
            return
        seen.add(key)
        rows.append(row)

    for action in flow.get("actions", []):
        if not isinstance(action, dict):
            continue
        aid = clean_text(action.get("actionId"))
        atype = clean_text(action.get("type")).upper()
        caption = clean_text(action.get("caption"))
        if atype == "MENU":
            for index, case in enumerate(action.get("cases") or [], start=1):
                add(
                    {
                        "kind": "menu_case",
                        "sourceActionId": aid,
                        "sourceCaption": caption,
                        "caseValues": [clean_text(case.get("value") or index)],
                        "target": clean_text(case.get("target")),
                        "category": normalize_human_text(caption or f"Menu {aid}"),
                        "treatment": f"Opcao {clean_text(case.get('value') or index)}",
                        "audio": action_audio_text(action, prompt_index, 160),
                        "confidence": "deterministic",
                    }
                )
        for path in iter_action_audio_paths(action):
            add(
                {
                    "kind": "prompt",
                    "sourceActionId": aid,
                    "sourceCaption": caption,
                    "caseValues": [],
                    "category": "Prompt",
                    "treatment": audio_subject_from_path(path) or normalize_human_text(caption),
                    "audio": re.split(r"[\\/]", clean_text(path))[-1],
                    "confidence": "deterministic",
                }
            )
        for entry in parse_switch_case_tree(action_code(action)):
            assignments = entry.get("assignments") or {}
            audio = assignment_value(assignments, ["AUDIO", "audio", "NOTEMENU", "notemenu", "menu_audio1", "menu_audio2", "audio_menu1", "audio_menu2", "audio_menu3"])
            next_step = assignment_value(assignments, ["NEXT_STEP", "next_step", "nextStep"])
            skill_id = assignment_value(assignments, ["SKILL_ID", "SkillID", "skillId", "skill_id"])
            skill_name = assignment_value(assignments, ["SKILL_NAME", "SkillName", "skillName", "skill_name"])
            scriptpoint = assignment_value(assignments, ["scriptpoint"])
            mapa_dna = assignment_value(assignments, ["mapa_dna", "MAPA_DNA"])
            transfer_code = assignment_value(assignments, ["TRANSFERCODE", "transferCode", "TransferCode"])
            assunto = assignment_value(assignments, ["Assunto", "assunto"])
            if any([audio, next_step, skill_id, skill_name, scriptpoint, mapa_dna, transfer_code, assunto]):
                subject = subject_from_skill_name(skill_name) or audio_subject_from_path(audio) or normalize_human_text(assunto or caption)
                technical_only = bool(scriptpoint or mapa_dna) and not any([audio, next_step, skill_id, skill_name, transfer_code, assunto])
                add(
                    {
                        "kind": "technical_detail" if technical_only else "snippet_case",
                        "sourceActionId": aid,
                        "sourceCaption": caption,
                        "caseValues": entry.get("caseValues") or [],
                        "caseRangeLabel": clean_text(entry.get("caseRangeLabel")),
                        "switchVariable": clean_text(entry.get("switchVariable")),
                        "category": category_for_subject(subject),
                        "treatment": subject,
                        "audio": re.split(r"[\\/]", audio)[-1] if audio else "",
                        "nextStep": next_step,
                        "skillId": skill_id,
                        "skillName": skill_name,
                        "scriptpoint": scriptpoint,
                        "mapaDna": mapa_dna,
                        "transferCode": transfer_code,
                        "confidence": "deterministic",
                    }
                )
    for skill in flow.get("skills", []):
        if not isinstance(skill, dict):
            continue
        source = find_action(flow, clean_text(skill.get("sourceActionId")))
        subject = subject_from_skill_name(skill.get("name")) or normalize_human_text(skill.get("sourceActionCaption"))
        add(
            {
                "kind": "skill",
                "sourceActionId": clean_text(skill.get("sourceActionId")),
                "sourceCaption": clean_text(skill.get("sourceActionCaption")),
                "caseValues": [],
                "category": category_for_subject(subject),
                "treatment": subject or clean_text(skill.get("name") or skill.get("id")),
                "audio": action_audio_text(source, prompt_index, 160) if source else "",
                "skillId": clean_text(skill.get("id")),
                "skillName": clean_text(skill.get("name")),
                "nextStep": clean_text(skill.get("nextStep")),
                "confidence": clean_text(skill.get("confidence") or "explicit"),
            }
        )
    return rows


def dynamic_sections(flow: Dict[str, Any]) -> List[str]:
    sections: List[str] = []
    for row in semantic_rows(flow):
        label = row.get("category") or row.get("treatment")
        if label and label not in sections:
            sections.append(label)
    if not sections:
        for menu in flow.get("menus", []):
            label = normalize_human_text(menu.get("caption") or f"Menu {menu.get('actionId')}")
            if label and label not in sections:
                sections.append(label)
    return sections[:12] or [flow.get("project", {}).get("name") or "Fluxo NICE"]


def is_alo_rh_flow(flow: Dict[str, Any]) -> bool:
    text = json.dumps(
        {
            "project": flow.get("project", {}),
            "skills": flow.get("skills", [])[:80],
            "menus": flow.get("menus", [])[:30],
        },
        ensure_ascii=False,
        default=str,
    ).upper()
    markers = ["URA_ALO_RH", "ALO_RH_CLARO", "ALO_RH_BCC", "ALO_RH_HITSS"]
    company_count = sum(1 for marker in ["CLARO.ALO.RH", "BCC.ALO.RH", "HITSS.ALO.RH"] if marker in text)
    return any(marker in text for marker in markers) or company_count >= 2


def ai_annotation_index(ai: Optional[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    result: Dict[str, Dict[str, Any]] = {}
    if not isinstance(ai, dict):
        return result
    for key in ("drawioAnnotations", "nodeAnnotations"):
        for item in ai.get(key, []) or []:
            if not isinstance(item, dict):
                continue
            aid = clean_text(item.get("actionId") or item.get("nodeId"))
            if ":" in aid:
                aid = aid.rsplit(":", 1)[-1]
            if aid:
                result[aid] = item
    return result


def ai_label_for_action(action: Optional[Dict[str, Any]], annotations: Dict[str, Dict[str, Any]], fallback: str = "") -> str:
    if not action:
        return fallback
    aid = clean_text(action.get("actionId"))
    annotation = annotations.get(aid, {})
    label = (
        clean_text(annotation.get("businessLabel"))
        or clean_text(annotation.get("title"))
        or clean_text(annotation.get("category"))
        or fallback
    )
    return label


def ai_menu_index(ai: Optional[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    result: Dict[str, Dict[str, Any]] = {}
    if not isinstance(ai, dict):
        return result
    for item in ai.get("menuInterpretation", []) or []:
        if not isinstance(item, dict):
            continue
        aid = clean_text(item.get("actionId") or item.get("menuId"))
        if aid:
            result[aid] = item
    return result


def ai_context_lines(ai: Optional[Dict[str, Any]]) -> List[str]:
    if not isinstance(ai, dict):
        return []
    context = ai.get("context") or {}
    lines = []
    purpose = clean_text(context.get("businessPurpose") or ai.get("businessSummary") or ai.get("functionalOverview"))
    flow_type = clean_text(context.get("flowType"))
    domains = ", ".join(clean_text(item) for item in as_list(context.get("mainDomains")) if clean_text(item))
    audience = ", ".join(clean_text(item) for item in as_list(context.get("audience")) if clean_text(item))
    if purpose:
        lines.append("Objetivo: " + short_label(purpose, 110))
    if flow_type:
        lines.append("Tipo: " + short_label(flow_type, 80))
    if domains:
        lines.append("Dominios: " + short_label(domains, 90))
    if audience:
        lines.append("Publico: " + short_label(audience, 90))
    return lines[:4]


def human_menu_title(menu: Dict[str, Any], annotations: Dict[str, Dict[str, Any]]) -> str:
    variable = menu_variable(menu.get("parameters"))
    label = ai_label_for_action(menu, annotations, clean_text(menu.get("caption")) or "Menu")
    lines = [short_label(label, 46), action_ref(menu)]
    if variable:
        lines.append(f"Captura: {variable}")
    options = menu_options_label(menu)
    if options:
        lines.append(short_label(options.replace("\n", " | "), 70))
    return "\n".join(lines)


def find_representative_menu(flow: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    menus = [action for action in flow.get("actions", []) if isinstance(action, dict) and clean_text(action.get("type")).upper() == "MENU"]
    if not menus:
        return None
    _actions_map, _adjacency, incoming = build_navigation_maps(flow)
    _order, levels = navigation_order(flow)

    def score(menu: Dict[str, Any]) -> Tuple[int, Tuple[int, str]]:
        aid = clean_text(menu.get("actionId"))
        caption = clean_text(menu.get("caption")).lower()
        params = menu.get("parameters")
        variable = menu_variable(params).lower()
        text = " ".join([caption, variable, json.dumps(params, ensure_ascii=False, default=str).lower()])
        value = 0
        value -= levels.get(aid, 0) * 8
        value += len(menu.get("cases") or []) * 12
        value += len(menu.get("branches") or []) * 4
        if incoming.get(aid, 0) <= 1:
            value += 18
        if any(token in text for token in ["menuprincipal", "menuinicial", "sauda", "principal", "mres"]):
            value += 35
        if variable in {"mres", "mres1", "op_escolhida", "opcao", "audio"}:
            value += 20
        if any(token in text for token in ["collect", "collec", "cpf", "cel", "cartao", "numero", "num"]):
            value -= 45
        return (value, sort_action_id(aid))

    return sorted(menus, key=score, reverse=True)[0]


def find_representative_rule(flow: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    order, levels = navigation_order(flow)
    candidates = []
    for aid in order:
        action = find_action(flow, aid)
        if not action or clean_text(action.get("type")).upper() != "IF":
            continue
        text = " ".join([clean_text(action.get("caption")), action_code(action)]).lower()
        score = 100 - levels.get(aid, 0)
        if any(token in text for token in ["bloq", "horario", "ani", "emerg", "indispon", "valida"]):
            score += 25
        if any(token in text for token in ["cpf", "cel", "cartao"]):
            score -= 20
        candidates.append((score, action))
    if not candidates:
        return None
    return sorted(candidates, key=lambda item: item[0], reverse=True)[0][1]


def menu_option_rows(menu: Optional[Dict[str, Any]], ai: Optional[Dict[str, Any]], rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not menu:
        return []
    menu_id = clean_text(menu.get("actionId"))
    menu_ai = ai_menu_index(ai).get(menu_id, {})
    options: List[Dict[str, Any]] = []
    for option in menu_ai.get("options", []) or []:
        if not isinstance(option, dict):
            continue
        digit = clean_text(option.get("digit"))
        label = clean_text(option.get("label"))
        target = clean_text(option.get("target"))
        if digit or label or target:
            options.append({"digit": digit, "label": label or f"Opcao {digit}", "target": target, "source": "ai"})
    if not options:
        for case in menu.get("cases") or []:
            digit = clean_text(case.get("value") or case.get("name"))
            target = clean_text(case.get("target"))
            label = f"Opcao {digit}" if digit else "Opcao"
            options.append({"digit": digit, "label": label, "target": target, "source": "case"})
    if options:
        return options[:8]
    fallback = [row for row in rows if clean_text(row.get("sourceActionId")) == menu_id]
    return [
        {
            "digit": ", ".join(row.get("caseValues") or []) or str(index + 1),
            "label": clean_text(row.get("treatment") or row.get("category") or "Opcao"),
            "target": clean_text(row.get("target") or row.get("nextStep") or row.get("skillName")),
            "source": "semantic",
        }
        for index, row in enumerate(fallback[:8])
    ]


def route_rows_for_option(option: Dict[str, Any], rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    digit = clean_text(option.get("digit"))
    target = clean_text(option.get("target"))
    related = []
    for row in rows:
        case_values = [clean_text(item) for item in row.get("caseValues") or []]
        if digit and digit in case_values:
            related.append(row)
            continue
        if target and clean_text(row.get("sourceActionId")) == target:
            related.append(row)
            continue
        if target and clean_text(row.get("target")) == target:
            related.append(row)
    return related


def semantic_options_from_rows(rows: List[Dict[str, Any]], limit: int = 16) -> List[Dict[str, Any]]:
    options: List[Dict[str, Any]] = []
    seen = set()
    for row in rows:
        if row.get("kind") == "prompt":
            continue
        case_values = [clean_text(item) for item in row.get("caseValues") or [] if clean_text(item)]
        digit = "/".join(case_values)
        label = clean_text(row.get("treatment") or row.get("category") or row.get("nextStep") or row.get("skillName"))
        target = clean_text(row.get("target") or row.get("nextStep") or row.get("skillName") or row.get("transferCode"))
        if not label and not target:
            continue
        key = (digit, label, target, clean_text(row.get("sourceActionId")))
        if key in seen:
            continue
        seen.add(key)
        options.append(
            {
                "digit": digit or str(len(options) + 1),
                "label": label or target,
                "target": target,
                "sourceActionId": clean_text(row.get("sourceActionId")),
                "source": "semantic",
            }
        )
        if len(options) >= limit:
            break
    return options


def action_semantic_details(action: Optional[Dict[str, Any]], rows: List[Dict[str, Any]], prompt_index: Dict[str, List[Dict[str, Any]]]) -> List[str]:
    if not action:
        return []
    aid = clean_text(action.get("actionId"))
    details: List[str] = []
    for line in prompt_lines_for_action(action, prompt_index, 2):
        details.append(line)
    for row in rows:
        if clean_text(row.get("sourceActionId")) != aid:
            continue
        parts = []
        if row.get("caseValues"):
            parts.append("Opcao " + "/".join(row.get("caseValues") or []))
        if row.get("audio"):
            parts.append("Audio " + clean_text(row.get("audio")))
        if row.get("nextStep"):
            parts.append("NEXT_STEP " + clean_text(row.get("nextStep")))
        if row.get("skillName") or row.get("skillId"):
            parts.append("Skill " + clean_text(row.get("skillName") or row.get("skillId")))
        if row.get("transferCode"):
            parts.append("TransferCode " + clean_text(row.get("transferCode")))
        if row.get("scriptpoint"):
            parts.append("SP " + clean_text(row.get("scriptpoint")))
        if parts:
            details.append(" | ".join(parts))
    if action.get("nextStep"):
        details.append("NEXT_STEP " + clean_text(action.get("nextStep")))
    if action.get("transferCode"):
        details.append("TransferCode " + clean_text(action.get("transferCode")))
    return [short_label(item, 90) for item in details[:6]]


def human_action_node_label(action: Dict[str, Any], rows: List[Dict[str, Any]], prompt_index: Dict[str, List[Dict[str, Any]]], annotations: Dict[str, Dict[str, Any]]) -> str:
    title = ai_label_for_action(action, annotations, clean_text(action.get("caption")) or clean_text(action.get("type")))
    lines = [
        short_label(title, 58),
        f"ActionID {action.get('actionId')} | {clean_text(action.get('type'))}",
    ]
    details = action_semantic_details(action, rows, prompt_index)
    lines.extend(details[:4])
    return "\n".join(unique_visual_lines(lines))


def option_display_label(option: Dict[str, Any], related_rows: List[Dict[str, Any]]) -> str:
    label = clean_text(option.get("label")) or "Opcao"
    digit = clean_text(option.get("digit"))
    lines = [f"{digit} - {short_label(label, 52)}" if digit else short_label(label, 58)]
    for row in related_rows[:4]:
        detail = clean_text(row.get("treatment") or row.get("category") or row.get("nextStep") or row.get("skillName"))
        if detail:
            lines.append("- " + short_label(detail, 48))
        if row.get("audio"):
            lines.append("Audio: " + short_label(row.get("audio"), 44))
        if row.get("nextStep"):
            lines.append("Vai para: " + short_label(row.get("nextStep"), 44))
        if row.get("transferCode"):
            lines.append("Transfer: " + short_label(row.get("transferCode"), 44))
    return "\n".join(lines[:7])


def build_functional_journey_pages(flow: Dict[str, Any], ai: Optional[Dict[str, Any]] = None) -> List[str]:
    annotations = ai_annotation_index(ai)
    prompt_index = prompt_index_by_action(flow)
    rows = semantic_rows(flow)
    menus = [action for action in flow.get("actions", []) if isinstance(action, dict) and clean_text(action.get("type")).upper() == "MENU"]
    actions_map, adjacency, _incoming = build_navigation_maps(flow)
    pages: List[str] = []
    for menu_index, menu in enumerate(menus[:8], start=1):
        menu_id = clean_text(menu.get("actionId"))
        options = menu_option_rows(menu, ai, rows)
        if not options:
            related = [row for row in rows if clean_text(row.get("sourceActionId")) == menu_id]
            options = [
                {
                    "digit": ", ".join(row.get("caseValues") or []) or str(index + 1),
                    "label": clean_text(row.get("treatment") or row.get("category") or f"Opcao {index + 1}"),
                    "target": clean_text(row.get("target") or row.get("nextStep")),
                    "source": "semantic",
                }
                for index, row in enumerate(related[:12])
            ]
        if not options:
            options = semantic_options_from_rows(rows, 16)
        if not options and len(menus) > 1:
            continue

        page_prefix = f"journey_{menu_index}_{safe_drawio_id(menu_id)}"
        page_name = "Jornada Funcional" if menu_index == 1 else f"Jornada Funcional {menu_index}"
        cells = [
            mx_node(f"{page_prefix}_title", f"{page_name} - {short_label(menu.get('caption') or 'Menu', 60)}", 300, 25, 1000, 42, "title"),
            mx_node(f"{page_prefix}_sub", "Jornada humanizada com menu, opcoes, audios, regras, integracoes e saidas principais.", 250, 68, 1100, 30, "subtitle"),
            mx_node(f"{page_prefix}_menu", human_menu_title(menu, annotations), 620, 130, 340, 130, "decision"),
        ]
        x_positions = [70, 430, 790, 1150]
        route_row_gap = 560
        route_end_ids: List[str] = []
        for index, option in enumerate(options[:16]):
            related_rows = route_rows_for_option(option, rows)
            if not related_rows and clean_text(option.get("sourceActionId")):
                related_rows = [row for row in rows if clean_text(row.get("sourceActionId")) == clean_text(option.get("sourceActionId"))]
            col = index % 4
            row = index // 4
            x = x_positions[col]
            y = 360 + row * route_row_gap
            option_id = f"{page_prefix}_option_{index}"
            cells.append(mx_node(option_id, option_display_label(option, related_rows), x, y, 300, 145, "process"))
            cells.append(mx_edge(f"{page_prefix}_e_menu_{index}", f"{page_prefix}_menu", option_id, clean_text(option.get("digit")) or str(index + 1)))

            target = clean_text(option.get("target"))
            target_action = actions_map.get(target)
            next_action = None
            if not target_action:
                for related in related_rows:
                    candidate = actions_map.get(clean_text(related.get("sourceActionId")))
                    if candidate:
                        target_action = candidate
                        break
            if target_action:
                target_id = f"{page_prefix}_target_{index}"
                cells.append(mx_node(target_id, human_action_node_label(target_action, rows, prompt_index, annotations), x, y + 185, 300, 135, action_style(target_action)))
                cells.append(mx_edge(f"{page_prefix}_e_target_{index}", option_id, target_id, "executa"))
                route_end_ids.append(target_id)
                outgoing = [edge for edge in adjacency.get(clean_text(target_action.get("actionId")), []) if clean_text(edge.get("target")) in actions_map]
                if outgoing:
                    next_action = actions_map.get(clean_text(outgoing[0].get("target")))
            if next_action and clean_text(next_action.get("actionId")) != clean_text((target_action or {}).get("actionId")):
                next_id = f"{page_prefix}_next_{index}"
                cells.append(mx_node(next_id, human_action_node_label(next_action, rows, prompt_index, annotations), x, y + 350, 300, 120, action_style(next_action)))
                cells.append(mx_edge(f"{page_prefix}_e_next_{index}", route_end_ids[-1], next_id, "proximo"))
                route_end_ids[-1] = next_id

        y_base = 360 + ((len(options[:16]) + 3) // 4) * route_row_gap + 100
        integrations = [
            action
            for action in flow.get("actions", [])
            if isinstance(action, dict) and clean_text(action.get("type")).upper() in {"RUNSCRIPT", "RUNSUB", "REST_API", "REQAGENT"}
        ]
        if integrations:
            lines = [
                f"{clean_text(action.get('type'))} {action.get('actionId')} - {short_label(ai_label_for_action(action, annotations, clean_text(action.get('caption'))), 45)}"
                for action in integrations[:8]
            ]
            cells.append(mx_node(f"{page_prefix}_integrations", "Integracoes e transferencias\n" + "\n".join(lines), 500, y_base, 600, 155, "transfer"))
            for end_id in route_end_ids[:10]:
                cells.append(mx_edge(f"{page_prefix}_e_int_{safe_drawio_id(end_id)}", end_id, f"{page_prefix}_integrations", "segue"))
            end_source = f"{page_prefix}_integrations"
            end_y = y_base + 220
        else:
            end_source = route_end_ids[0] if route_end_ids else f"{page_prefix}_menu"
            end_y = y_base
        cells.append(mx_node(f"{page_prefix}_end", "Fim / proximo script / retorno", 675, end_y, 250, 60, "terminal_end"))
        cells.append(mx_edge(f"{page_prefix}_e_end", end_source, f"{page_prefix}_end"))
        pages.append(mx_diagram(page_name, cells, 1600, max(1100, end_y + 160)))
    return pages


def build_generic_human_main_flow_page(flow: Dict[str, Any], ai: Optional[Dict[str, Any]] = None) -> str:
    project = flow.get("project", {})
    annotations = ai_annotation_index(ai)
    prompt_index = prompt_index_by_action(flow)
    begin = find_first_action(flow, "BEGIN")
    first_menu = find_representative_menu(flow)
    first_rule = find_representative_rule(flow)
    integrations = [
        action
        for action in flow.get("actions", [])
        if isinstance(action, dict) and clean_text(action.get("type")).upper() in {"RUNSCRIPT", "RUNSUB", "REST_API", "REQAGENT"}
    ]
    rows = semantic_rows(flow)
    categories: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        category = clean_text(row.get("category") or row.get("treatment") or "Rotas")
        if category.lower() == "prompt":
            continue
        categories.setdefault(category, []).append(row)
    category_items = sorted(categories.items(), key=lambda item: (-len(item[1]), item[0]))[:9]
    options = menu_option_rows(first_menu, ai, rows)
    if not options:
        options = [
            {"digit": str(index + 1), "label": category, "target": "", "source": "category"}
            for index, (category, _items) in enumerate(category_items[:8])
        ]
    if not options:
        options = semantic_options_from_rows(rows, 12)

    cells = [
        mx_node("human_title", f"Fluxograma {project.get('name', 'NICE')} - visao funcional", 300, 25, 1000, 42, "title"),
        mx_node("human_sub", "Resumo humanizado gerado do XML NICE com apoio da IA quando disponivel. A navegacao real fica preservada na pagina tecnica.", 220, 68, 1160, 30, "subtitle"),
        mx_node("human_start", f"Inicio\n{action_ref(begin)}", 690, 130, 180, 58, "terminal_start"),
        mx_node(
            "human_prepare",
            "Preparacao e validacoes\n"
            + short_label(ai_label_for_action(first_rule, annotations, clean_text(first_rule.get("caption") if first_rule else "validacoes iniciais")), 70)
            + ("\n" + action_ref(first_rule) if first_rule else ""),
            650,
            240,
            260,
            86,
            "process",
        ),
        mx_node(
            "human_menu",
            "Menu principal\n"
            + (human_menu_title(first_menu, annotations) if first_menu else "Nenhum menu principal identificado"),
            635,
            385,
            290,
            112,
            "decision",
        ),
        mx_edge("human_e1", "human_start", "human_prepare"),
        mx_edge("human_e2", "human_prepare", "human_menu"),
    ]
    context_lines = ai_context_lines(ai)
    if context_lines:
        cells.append(mx_node("human_context", "Contexto funcional\n" + "\n".join(context_lines), 60, 130, 430, 145, "note"))

    lane_y = 610
    lane_xs = [85, 455, 825, 1195]
    route_node_ids: List[str] = []
    route_cards = []
    for option in options[:12]:
        related = route_rows_for_option(option, rows)
        if not related and clean_text(option.get("sourceActionId")):
            related = [row for row in rows if clean_text(row.get("sourceActionId")) == clean_text(option.get("sourceActionId"))]
        if not related:
            related = categories.get(clean_text(option.get("label")), [])[:5]
        route_cards.append((option, related))
    if not route_cards:
        route_cards = [
            ({"digit": str(index + 1), "label": category, "target": "", "source": "category"}, items)
            for index, (category, items) in enumerate(category_items[:12])
        ]

    for index, (option, items) in enumerate(route_cards):
        col = index % 4
        row = index // 4
        x = lane_xs[col]
        y = lane_y + row * 260
        treatments = []
        for item in items[:5]:
            source_action = find_action(flow, clean_text(item.get("sourceActionId")))
            ai_value = ai_label_for_action(source_action, annotations)
            value = clean_text(ai_value or item.get("treatment") or item.get("skillName") or item.get("nextStep") or item.get("audio"))
            if value and value not in treatments:
                treatments.append(value)
        title = clean_text(option.get("label")) or (clean_text(items[0].get("category")) if items else f"Opcao {index + 1}")
        detail_lines = [f"DTMF: {clean_text(option.get('digit')) or '-'}"]
        if clean_text(option.get("target")):
            detail_lines.append(f"Destino: ActionID {short_label(option.get('target'), 30)}")
        detail_lines.extend(f"- {short_label(item, 38)}" for item in treatments[:3])
        node_id = f"human_route_{index}"
        route_node_ids.append(node_id)
        cells.append(mx_node(node_id, f"{short_label(title, 42)}\n" + "\n".join(detail_lines), x, y, 300, 142, "process"))
        cells.append(mx_edge(f"human_menu_route_{index}", "human_menu", node_id, short_label(clean_text(option.get("digit")) or str(index + 1), 14)))

    route_rows_count = max(1, (len(route_cards[:12]) + 3) // 4)
    integration_y = lane_y + route_rows_count * 260 + 30
    if integrations:
        integration_lines = []
        for action in integrations[:6]:
            label = ai_label_for_action(action, annotations, clean_text(action.get("caption")))
            integration_lines.append(f"{clean_text(action.get('type'))} {action.get('actionId')} - {short_label(label, 38)}")
        cells.append(mx_node("human_integrations", "Integracoes / transferencias\n" + "\n".join(integration_lines), 560, integration_y, 480, 155, "transfer"))
        for node_id in route_node_ids[:8]:
            cells.append(mx_edge(f"human_route_to_int_{node_id}", node_id, "human_integrations", "transfere/segue"))
        end_source = "human_integrations"
    else:
        end_source = route_node_ids[0] if route_node_ids else "human_menu"

    end_y = integration_y + (210 if integrations else 70)
    cells.append(mx_node("human_end", "Fim / retorno ao fluxo tecnico", 690, end_y, 180, 60, "terminal_end"))
    cells.append(mx_edge("human_end_edge", end_source, "human_end"))

    note_lines = [
        f"Actions: {len(flow.get('actions', []))}",
        f"Edges: {len(flow.get('edges', []))}",
        f"Menus: {len(flow.get('menus', []))}",
        f"Skills: {len(flow.get('skills', []))}",
    ]
    cells.append(mx_node("human_note", "Resumo tecnico\n" + "\n".join(note_lines), 70, end_y + 15, 260, 110, "note"))
    height = max(1100, end_y + 200)
    return mx_diagram("Fluxo Principal", cells, 1600, height)


def dynamic_main_action_ids(flow: Dict[str, Any], limit: int = 70) -> List[str]:
    order, _levels = navigation_order(flow)
    important_types = {"BEGIN", "HOURS", "MENU", "IF", "CASE", "SNIPPET", "RUNSCRIPT", "RUNSUB", "REST_API", "REQAGENT", "PLAY", "LOOP", "END"}
    selected: List[str] = []
    for aid in order:
        action = find_action(flow, aid)
        if not action:
            continue
        atype = clean_text(action.get("type")).upper()
        if atype in important_types or action.get("skills") or action.get("nextStep") or action.get("audio"):
            selected.append(aid)
        if len(selected) >= limit:
            break
    if not selected:
        selected = order[:limit]
    return selected


def compact_action_summary(action: Dict[str, Any], prompt_index: Dict[str, List[Dict[str, Any]]]) -> str:
    lines = [
        f"ActionID {action.get('actionId')}",
        f"{clean_text(action.get('type'))} - {short_label(action.get('caption'), 54)}",
    ]
    if clean_text(action.get("type")).upper() == "MENU":
        variable = menu_variable(action.get("parameters"))
        if variable:
            lines.append(f"Variavel: {variable}")
        if action.get("cases"):
            lines.append("Opcoes: " + short_label(", ".join(clean_text(case.get("value")) for case in action.get("cases", [])[:6]), 58))
    for item in prompt_lines_for_action(action, prompt_index, 1):
        lines.append(short_label(item, 62))
    if action.get("nextStep"):
        lines.append("NEXT_STEP: " + short_label(action.get("nextStep"), 48))
    if action.get("skills"):
        lines.append("Skill: " + short_label(", ".join(map(str, action.get("skills", [])[:2])), 54))
    return "\n".join(line for line in lines if clean_text(line))


def build_dynamic_human_main_flow_page(flow: Dict[str, Any], ai: Optional[Dict[str, Any]] = None) -> str:
    project = flow.get("project", {})
    actions_map, adjacency, _incoming = build_navigation_maps(flow)
    prompt_index = prompt_index_by_action(flow)
    selected = dynamic_main_action_ids(flow)
    visible = set(selected)
    _order, levels = navigation_order(flow)
    cells = [
        mx_node("dyn_main_title", f"Fluxograma {project.get('name', 'NICE')} - visao funcional", 280, 22, 1000, 42, "title"),
        mx_node("dyn_main_sub", "Gerado dinamicamente do XML NICE. Navegacao principal de cima para baixo; detalhes completos ficam em Acoes NICE completas.", 220, 66, 1140, 34, "subtitle"),
    ]
    node_w = 260
    node_h = 104
    x_center = 800
    x_gap = 330
    y_gap = 175
    max_cols = 4
    level_ids: Dict[int, List[str]] = {}
    for aid in selected:
        level_ids.setdefault(levels.get(aid, 0), []).append(aid)
    normalized_rows: List[List[str]] = []
    for level in sorted(level_ids):
        ids = level_ids[level]
        for index in range(0, len(ids), max_cols):
            normalized_rows.append(ids[index : index + max_cols])

    positions: Dict[str, Tuple[int, int]] = {}
    y = 135
    for row_ids in normalized_rows:
        count = len(row_ids)
        start_x = x_center - ((count - 1) * x_gap) // 2 - node_w // 2
        for col, aid in enumerate(row_ids):
            action = actions_map.get(aid)
            if not action:
                continue
            x = start_x + col * x_gap
            positions[aid] = (x, y)
            cells.append(mx_node(f"dyn_main_{safe_drawio_id(aid)}", compact_action_summary(action, prompt_index), x, y, node_w, node_h, action_style(action)))
        y += y_gap

    edge_count = 0
    hidden_edges = 0
    for source in selected:
        for edge in adjacency.get(source, []):
            target = clean_text(edge.get("target"))
            source_id = f"dyn_main_{safe_drawio_id(source)}"
            if target in visible:
                edge_count += 1
                label = edge_label(edge)
                if positions.get(target, (0, 0))[1] <= positions.get(source, (0, 0))[1]:
                    label = short_label(f"{label} / retorno" if label else "retorno", 45)
                cells.append(mx_edge(f"dyn_main_e{edge_count}", source_id, f"dyn_main_{safe_drawio_id(target)}", label))
                continue
            if target:
                hidden_edges += 1

    section_text = "\n".join(f"- {short_label(item, 50)}" for item in dynamic_sections(flow)[:10])
    continuation = f"\n\n{hidden_edges} conexoes continuam nas paginas tecnicas." if hidden_edges else ""
    cells.append(mx_node("dyn_main_sections", "Principais agrupamentos detectados\n" + section_text + continuation, 70, y + 30, 620, 165, "note"))
    height = max(1000, y + 260)
    return mx_diagram("Fluxo Principal", cells, 1600, height)


def build_menu_table_page(flow: Dict[str, Any]) -> str:
    rows = semantic_rows(flow)
    menu_rows = [row for row in rows if row.get("kind") in {"menu_case", "snippet_case"}]
    cells = [mx_node("p2_title", "Mapa editavel de menus e opcoes", 210, 20, 900, 40, "title")]
    columns = [("Origem", 170), ("Opcao", 90), ("Categoria", 190), ("Tratamento", 270), ("ActionID", 90), ("Audio", 270), ("Next/Skill", 260)]
    x = 35
    for title, width in columns:
        cells.append(table_cell(f"p2_dyn_h_{safe_drawio_id(title)}", title, x, 90, width, 34, True))
        x += width
    if not menu_rows:
        menu_rows = [{"sourceCaption": "Nenhum menu reconhecido", "caseValues": [], "category": "-", "treatment": "-", "sourceActionId": "-", "audio": "", "nextStep": "", "skillName": ""}]
    for row_index, row in enumerate(menu_rows[:55]):
        x = 35
        y = 124 + row_index * 34
        next_or_skill = row.get("skillName") or row.get("skillId") or row.get("nextStep") or row.get("target") or ""
        values = [
            row.get("sourceCaption") or row.get("kind"),
            ", ".join(row.get("caseValues") or []) or "-",
            row.get("category"),
            row.get("treatment"),
            row.get("sourceActionId"),
            row.get("audio"),
            next_or_skill,
        ]
        for col_index, ((_, width), value) in enumerate(zip(columns, values)):
            cells.append(table_cell(f"p2_dyn_{row_index}_{col_index}", short_label(value, 110), x, y, width, 34))
            x += width
    return mx_diagram("Mapa de Menus", cells, 1500, max(900, 180 + len(menu_rows[:55]) * 34))


def build_skill_table_page(flow: Dict[str, Any]) -> str:
    rows = [row for row in semantic_rows(flow) if row.get("skillId") or row.get("skillName")]
    cells = [mx_node("p3_title", "Mapa editavel de skills e transferencias", 320, 20, 900, 40, "title")]
    columns = [("Caminho/Opcao", 140), ("Ramo/Assunto", 240), ("Skill ID", 130), ("Skill Name", 300), ("ActionID", 100), ("Evidencia", 280)]
    x = 40
    for title, width in columns:
        cells.append(table_cell(f"p3_dyn_h_{safe_drawio_id(title)}", title, x, 90, width, 34, True))
        x += width
    if not rows:
        rows = [{"caseValues": [], "treatment": "Nenhuma skill explicita encontrada", "skillId": "-", "skillName": "-", "sourceActionId": "-", "sourceCaption": "-"}]
    for row_index, row in enumerate(rows[:60]):
        x = 40
        y = 124 + row_index * 34
        values = [
            ", ".join(row.get("caseValues") or []) or "-",
            row.get("treatment") or row.get("category"),
            row.get("skillId") or "-",
            row.get("skillName") or "-",
            row.get("sourceActionId"),
            row.get("sourceCaption"),
        ]
        for col_index, ((_, width), value) in enumerate(zip(columns, values)):
            cells.append(table_cell(f"p3_dyn_{row_index}_{col_index}", short_label(value, 120), x, y, width, 34))
            x += width
    return mx_diagram("Mapa de Skills", cells, 1350, max(900, 180 + len(rows[:60]) * 34))


TECHNICAL_GROUPS = [
    ("Entrada", "Tecnico - Entrada", "Inicio, horarios e preparacao do fluxo"),
    ("Menus", "Tecnico - Menus", "Menus, cases e selecao de opcoes"),
    ("Regras e Snippets", "Tecnico - Regras e Snippets", "Regras, atribuicoes, scriptpoints, audios e skills"),
    ("Captura Dados", "Tecnico - Captura Dados", "Capturas, validacoes e coleta de dados"),
    ("Integracoes", "Tecnico - Integracoes", "RUNSUB, RUNSCRIPT, REST_API e chamadas externas"),
    ("Atendimento", "Tecnico - Atendimento", "REQAGENT, fila, espera e eventos de atendimento"),
    ("Encerramento", "Tecnico - Encerramento", "Loops, finais, desligamento e tratamento de erro"),
]


def technical_group_for_action(action: Dict[str, Any]) -> str:
    atype = clean_text(action.get("type")).upper()
    text = " ".join([clean_text(action.get("caption")), action_code(action), clean_text(action.get("nextStep"))]).lower()
    if atype in {"BEGIN", "HOURS"}:
        return "Entrada"
    if atype in {"MENU", "CASE"}:
        return "Menus"
    if atype in {"RUNSCRIPT", "RUNSUB", "REST_API", "WORKFLOWDATA"} or any(token in text for token in ["next_step", "url", "body.", "rest_api"]):
        return "Integracoes"
    if atype in {"REQAGENT", "COUNTAGENTS", "WAIT", "ONANSWER", "ONRELEASE", "WHISPER", "MESSAGES"}:
        return "Atendimento"
    if atype in {"CAPTURE"} or any(token in text for token in ["cpf", "celular", "cartao", "collect", "collecnum", "digita", "check"]):
        return "Captura Dados"
    if atype in {"END", "LOOP"} or any(token in text for token in ["tchau", "desliga", "timeout", "maxsil", "maxinv", "erro", "reject"]):
        return "Encerramento"
    if atype in {"SNIPPET", "IF", "PLAY"}:
        return "Regras e Snippets"
    return "Regras e Snippets"


def next_functional_actions(
    start_action: Optional[Dict[str, Any]],
    actions_map: Dict[str, Dict[str, Any]],
    adjacency: Dict[str, List[Dict[str, Any]]],
    max_steps: int = 4,
) -> List[Dict[str, Any]]:
    if not start_action:
        return []
    path = [start_action]
    visited = {clean_text(start_action.get("actionId"))}
    current = start_action
    while len(path) < max_steps:
        current_id = clean_text(current.get("actionId"))
        outgoing = [edge for edge in adjacency.get(current_id, []) if clean_text(edge.get("target")) in actions_map]
        if not outgoing:
            break
        preferred = sorted(
            outgoing,
            key=lambda edge: 0 if clean_text(edge.get("label")).lower() in {"default", ""} else 1,
        )[0]
        target_id = clean_text(preferred.get("target"))
        if not target_id or target_id in visited:
            break
        next_action = actions_map.get(target_id)
        if not next_action:
            break
        path.append(next_action)
        visited.add(target_id)
        current = next_action
    return path


def build_consolidated_functional_main_page(flow: Dict[str, Any], ai: Optional[Dict[str, Any]] = None) -> str:
    project = flow.get("project", {})
    annotations = ai_annotation_index(ai)
    prompt_index = prompt_index_by_action(flow)
    rows = semantic_rows(flow)
    actions_map, adjacency, _incoming = build_navigation_maps(flow)
    begin = find_first_action(flow, "BEGIN")
    menus = [action for action in flow.get("actions", []) if isinstance(action, dict) and clean_text(action.get("type")).upper() == "MENU"]
    if not menus:
        return build_generic_human_main_flow_page(flow, ai or {})

    cells = [
        mx_node("main_title", f"Fluxograma {project.get('name', 'NICE')} - fluxo completo humanizado", 300, 25, 1040, 42, "title"),
        mx_node(
            "main_sub",
            "Fluxo funcional consolidado em uma pagina. Menus, submenus, audios, regras, integracoes e transferencias foram extraidos do XML NICE.",
            170,
            68,
            1300,
            30,
            "subtitle",
        ),
        mx_node("main_start", f"Inicio\n{action_ref(begin)}", 690, 125, 220, 64, "terminal_start"),
    ]

    context_lines = ai_context_lines(ai)
    if context_lines:
        cells.append(mx_node("main_context", "Contexto IA\n" + "\n".join(context_lines[:4]), 55, 120, 430, 145, "note"))

    previous_anchor = "main_start"
    y_cursor = 245
    page_prefix = "main_full"
    x_positions = [70, 440, 810, 1180]
    route_row_gap = 520
    rendered_menus = 0

    for menu_index, menu in enumerate(menus, start=1):
        menu_id = clean_text(menu.get("actionId"))
        options = menu_option_rows(menu, ai, rows)
        if not options:
            related = [row for row in rows if clean_text(row.get("sourceActionId")) == menu_id]
            options = [
                {
                    "digit": ", ".join(row.get("caseValues") or []) or str(index + 1),
                    "label": clean_text(row.get("treatment") or row.get("category") or f"Opcao {index + 1}"),
                    "target": clean_text(row.get("target") or row.get("nextStep")),
                    "sourceActionId": menu_id,
                    "source": "semantic",
                }
                for index, row in enumerate(related[:12])
            ]
        if not options and menu_index == 1:
            options = semantic_options_from_rows(rows, 16)

        if not options and rendered_menus > 0:
            continue

        section_id = f"{page_prefix}_section_{menu_index}_{safe_drawio_id(menu_id)}"
        menu_node_id = f"{page_prefix}_menu_{menu_index}_{safe_drawio_id(menu_id)}"
        cells.append(
            mx_node(
                section_id,
                f"Etapa {rendered_menus + 1}: {short_label(clean_text(menu.get('caption')) or 'Menu', 80)}",
                45,
                y_cursor,
                1500,
                34,
                "lane_header",
            )
        )
        cells.append(mx_node(menu_node_id, human_menu_title(menu, annotations), 610, y_cursor + 70, 360, 130, "decision"))
        cells.append(mx_edge(f"{page_prefix}_e_section_{menu_index}", previous_anchor, menu_node_id, "segue"))

        route_end_ids: List[str] = []
        visible_options = options[:16]
        if not visible_options:
            visible_options = [{"digit": "", "label": "Sem opcoes explicitas no XML", "target": "", "source": "empty"}]

        for option_index, option in enumerate(visible_options):
            related_rows = route_rows_for_option(option, rows)
            if not related_rows and clean_text(option.get("sourceActionId")):
                related_rows = [row for row in rows if clean_text(row.get("sourceActionId")) == clean_text(option.get("sourceActionId"))]

            col = option_index % 4
            row_index = option_index // 4
            x = x_positions[col]
            y = y_cursor + 265 + row_index * route_row_gap
            option_id = f"{page_prefix}_m{menu_index}_option_{option_index}"
            cells.append(mx_node(option_id, option_display_label(option, related_rows), x, y, 300, 145, "process"))
            cells.append(mx_edge(f"{page_prefix}_m{menu_index}_e_option_{option_index}", menu_node_id, option_id, clean_text(option.get("digit")) or str(option_index + 1)))

            target = clean_text(option.get("target"))
            target_action = actions_map.get(target)
            if not target_action and related_rows:
                for related in related_rows:
                    candidate = actions_map.get(clean_text(related.get("sourceActionId")))
                    if candidate:
                        target_action = candidate
                        break
            path = next_functional_actions(target_action, actions_map, adjacency, 4)
            previous_node = option_id
            for step_index, action in enumerate(path):
                action_id = f"{page_prefix}_m{menu_index}_opt{option_index}_step_{step_index}_{safe_drawio_id(action.get('actionId'))}"
                cells.append(
                    mx_node(
                        action_id,
                        human_action_node_label(action, rows, prompt_index, annotations),
                        x,
                        y + 180 + step_index * 132,
                        300,
                        112,
                        action_style(action),
                    )
                )
                cells.append(mx_edge(f"{page_prefix}_m{menu_index}_opt{option_index}_e_step_{step_index}", previous_node, action_id, "executa" if step_index == 0 else "proximo"))
                previous_node = action_id
            route_end_ids.append(previous_node)

        rows_count = max(1, (len(visible_options) + 3) // 4)
        section_bottom = y_cursor + 265 + rows_count * route_row_gap
        next_menu_anchor = route_end_ids[0] if route_end_ids else menu_node_id
        for end_id in route_end_ids[1:8]:
            cells.append(mx_edge(f"{page_prefix}_m{menu_index}_join_{safe_drawio_id(end_id)}", end_id, next_menu_anchor, "continua"))
        previous_anchor = next_menu_anchor
        rendered_menus += 1
        y_cursor = section_bottom + 160

    integrations = [
        action
        for action in flow.get("actions", [])
        if isinstance(action, dict) and clean_text(action.get("type")).upper() in {"RUNSCRIPT", "RUNSUB", "REST_API", "REQAGENT"}
    ]
    if integrations:
        lines = [
            f"{clean_text(action.get('type'))} {action.get('actionId')} - {short_label(ai_label_for_action(action, annotations, clean_text(action.get('caption'))), 58)}"
            for action in integrations[:12]
        ]
        cells.append(mx_node("main_integrations", "Integracoes e transferencias\n" + "\n".join(lines), 460, y_cursor, 680, 210, "transfer"))
        cells.append(mx_edge("main_e_integrations", previous_anchor, "main_integrations", "transfere/integra"))
        previous_anchor = "main_integrations"
        y_cursor += 270

    note_lines = [
        f"Actions: {len(flow.get('actions', []))}",
        f"Edges: {len(flow.get('edges', []))}",
        f"Menus: {len(flow.get('menus', []))}",
        f"Prompts: {len(flow.get('prompts', []))}",
    ]
    cells.append(mx_node("main_summary", "Resumo tecnico\n" + "\n".join(note_lines), 60, y_cursor, 280, 116, "note"))
    cells.append(mx_node("main_end", "Fim / transferencia / retorno", 675, y_cursor + 20, 250, 70, "terminal_end"))
    cells.append(mx_edge("main_e_end", previous_anchor, "main_end", "fim"))
    return mx_diagram("Fluxo Principal", cells, 1650, max(1200, y_cursor + 180))


def build_main_flow_page(flow: Dict[str, Any], ai: Optional[Dict[str, Any]] = None) -> str:
    return build_consolidated_functional_main_page(flow, ai or {})


def build_single_technical_page(flow: Dict[str, Any], ai: Dict[str, Any]) -> str:
    annotations = {str(item.get("actionId")): item for item in ai.get("drawioAnnotations", []) if isinstance(item, dict)}
    prompt_index = prompt_index_by_action(flow)
    actions_map = action_by_id(flow)
    groups = technical_groups(flow)
    cells = [
        mx_node("single_tech_title", "Fluxograma Técnico Editável", 420, 25, 900, 42, "title"),
        mx_node(
            "single_tech_sub",
            "Todas as actions e conexoes reais do XML NICE em uma unica pagina tecnica, agrupadas por tipo funcional.",
            280,
            68,
            1180,
            30,
            "subtitle",
        ),
    ]
    node_width = 250
    node_height = 88
    col_gap = 315
    row_gap = 126
    columns = 5
    y_cursor = 125
    node_ids: Dict[str, str] = {}
    group_styles = {
        "Entrada": "terminal_start",
        "Menus": "decision",
        "Regras e Snippets": "process",
        "Captura Dados": "data",
        "Integracoes": "transfer",
        "Atendimento": "transfer",
        "Encerramento": "terminal_end",
    }

    for group_id, _page_name, description in TECHNICAL_GROUPS:
        action_ids = [aid for aid in groups.get(group_id, []) if aid in actions_map]
        if not action_ids:
            continue
        rows = (len(action_ids) + columns - 1) // columns
        section_height = 52 + rows * row_gap + 30
        cells.append(
            mx_node(
                f"single_tech_group_{safe_drawio_id(group_id)}",
                f"{group_id} - {description} ({len(action_ids)} actions)",
                40,
                y_cursor,
                1660,
                34,
                group_styles.get(group_id, "process"),
            )
        )
        for index, aid in enumerate(action_ids):
            row = index // columns
            col = index % columns
            x = 55 + col * col_gap
            y = y_cursor + 58 + row * row_gap
            cell_id = f"single_tech_{safe_drawio_id(aid)}"
            node_ids[aid] = cell_id
            action = actions_map[aid]
            cells.append(
                mx_node(
                    cell_id,
                    technical_node_label(action, prompt_index, annotations),
                    x,
                    y,
                    node_width,
                    node_height,
                    action_style(action),
                )
            )
        y_cursor += section_height

    edge_count = 0
    for edge in flow.get("edges", []):
        source = clean_text(edge.get("source"))
        target = clean_text(edge.get("target"))
        if source not in node_ids or target not in node_ids:
            continue
        edge_count += 1
        cells.append(mx_edge(f"single_tech_e{edge_count}", node_ids[source], node_ids[target], edge_label(edge)))

    if not node_ids:
        cells.append(mx_node("single_tech_empty", "Nenhuma action tecnica encontrada.", 560, 180, 480, 80, "warning"))
    return mx_diagram("Fluxograma Técnico Editável", cells, 1800, max(1000, y_cursor + 80))


def build_raw_actions(flow: Dict[str, Any]) -> Dict[str, Any]:
    actions = []
    for action in flow.get("actions", []):
        if not isinstance(action, dict):
            continue
        actions.append(
            {
                "actionId": clean_text(action.get("actionId")),
                "type": clean_text(action.get("type")),
                "caption": clean_text(action.get("caption")),
                "parameters": action.get("parameters") or [],
                "defaultNextAction": clean_text(action.get("defaultNextAction")),
                "branches": action.get("branches") or [],
                "cases": action.get("cases") or [],
                "x": action.get("x"),
                "y": action.get("y"),
                "raw": action.get("raw") or {},
            }
        )
    return {
        "project": {
            **(flow.get("project") or {}),
            "source": "NICE Studio XML",
        },
        "actions": actions,
        "edges": flow.get("edges", []),
    }


def ai_organizer_indexes(ai_organizer: Dict[str, Any]) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    action_index = {
        clean_text(item.get("actionId")): item
        for item in ai_organizer.get("actionAnnotations", [])
        if isinstance(item, dict) and clean_text(item.get("actionId"))
    }
    menu_index = {
        clean_text(item.get("menuActionId")): item
        for item in ai_organizer.get("menuLabels", [])
        if isinstance(item, dict) and clean_text(item.get("menuActionId"))
    }
    return action_index, menu_index


def deterministic_ai_organizer(flow: Dict[str, Any]) -> Dict[str, Any]:
    actions = flow.get("actions", [])
    menus = [action for action in actions if isinstance(action, dict) and clean_text(action.get("type")).upper() == "MENU"]
    annotations = []
    for action in actions:
        if not isinstance(action, dict):
            continue
        label = clean_text(action.get("caption")) or clean_text(action.get("type")) or f"Action {action.get('actionId')}"
        annotations.append(
            {
                "actionId": clean_text(action.get("actionId")),
                "businessLabel": short_label(label, 80),
                "shortLabel": short_label(label, 42),
                "description": f"{clean_text(action.get('type'))} extraida deterministicamente do XML NICE.",
                "category": clean_text(action.get("type")).lower(),
                "group": technical_group_for_action(action),
                "riskLevel": "low",
                "confidence": 0.75,
                "evidence": [f"ActionID {action.get('actionId')}", f"type {action.get('type')}"],
            }
        )
    menu_labels = []
    for menu in menus:
        options = []
        for case in menu.get("cases") or []:
            digit = clean_text(case.get("value") or case.get("name"))
            target = clean_text(case.get("target"))
            if digit or target:
                options.append(
                    {
                        "digit": digit,
                        "label": f"Opcao {digit}" if digit else "Opcao",
                        "description": "Opcao extraida do CASE do menu.",
                        "targetActionId": target,
                        "confidence": 0.8,
                        "evidence": [f"MENU ActionID {menu.get('actionId')}", f"CASE {digit}"],
                    }
                )
        menu_labels.append(
            {
                "menuActionId": clean_text(menu.get("actionId")),
                "menuName": clean_text(menu.get("caption")) or "Menu",
                "captureVariable": menu_variable(menu.get("parameters")),
                "options": options,
            }
        )
    return {
        "flowContext": {
            "flowName": flow.get("project", {}).get("name", "URA"),
            "flowType": "URA NICE",
            "businessPurpose": "Documentacao funcional gerada deterministicamente.",
            "audience": ["Negocio", "Desenvolvimento", "Sustentacao"],
            "mainDomains": [],
            "mainJourneys": [clean_text(menu.get("caption")) for menu in menus[:8]],
        },
        "actionAnnotations": annotations,
        "menuLabels": menu_labels,
        "visualGroups": [],
        "routeHints": [],
        "drawioRecommendations": {
            "mainPageTitle": "Fluxo principal da URA",
            "maxMainBlocks": 18,
            "suggestedPages": [
                "Fluxo Principal",
                "Mapa de Menus",
                "Mapa de Skills",
                "Fluxograma Tecnico Editavel",
            ],
        },
        "issues": [],
    }


def build_semantic_model(raw_actions: Dict[str, Any], ai_organizer: Dict[str, Any], transcriptions: Dict[str, Any], flow: Dict[str, Any]) -> Dict[str, Any]:
    action_index, _menu_index = ai_organizer_indexes(ai_organizer)
    prompts_by_action = prompt_index_by_action(flow)
    actions = []
    for action in flow.get("actions", []):
        if not isinstance(action, dict):
            continue
        aid = clean_text(action.get("actionId"))
        ann = action_index.get(aid, {})
        actions.append(
            {
                **action,
                "businessLabel": clean_text(ann.get("businessLabel") or ann.get("title") or action.get("caption")),
                "shortLabel": clean_text(ann.get("shortLabel") or ann.get("businessLabel") or action.get("caption")),
                "description": clean_text(ann.get("description")),
                "group": clean_text(ann.get("group") or technical_group_for_action(action)),
                "category": clean_text(ann.get("category") or action.get("type")).lower(),
                "prompts": prompts_by_action.get(aid, []),
            }
        )
    return {
        "project": raw_actions.get("project") or flow.get("project") or {},
        "actions": actions,
        "edges": flow.get("edges", []),
        "menus": flow.get("menus", []),
        "prompts": flow.get("prompts", []),
        "skills": flow.get("skills", []),
        "snippetSemantics": semantic_rows(flow),
        "events": flow.get("events", []),
        "timeouts": flow.get("timeouts", []),
        "cdrVariables": flow.get("cdrVariables", []),
        "externalTargets": flow.get("externalTargets", []),
        "aiOrganizer": ai_organizer,
        "transcriptions": transcriptions,
    }


SIDE_TREATMENT_TOKENS = {
    "timeout",
    "interdigit",
    "maxdigit",
    "invalid",
    "inval",
    "repeat",
    "max",
    "sil",
    "rej",
    "reje",
    "closed",
    "holiday",
    "meeting",
    "emergency",
    "false",
}


def edge_execution_kind(source_action: Optional[Dict[str, Any]], edge: Dict[str, Any]) -> str:
    atype = clean_text((source_action or {}).get("type")).upper()
    label = edge_label_text(edge).lower()
    if atype == "MENU" and label in {"", "default"}:
        return "menu_default"
    if atype == "LOCATE" and label == "found":
        return "locate_found"
    if atype == "CASE" or clean_text(edge.get("kind")).lower() == "case":
        return "case"
    if atype == "LOOP" or any(token in label for token in SIDE_TREATMENT_TOKENS):
        return "side_treatment"
    if atype == "IF":
        return "decision_branch"
    if label in {"", "default"}:
        return "default"
    return clean_text(edge.get("kind") or label or "branch")


def is_side_treatment_edge(source_action: Optional[Dict[str, Any]], edge: Dict[str, Any]) -> bool:
    return edge_execution_kind(source_action, edge) == "side_treatment"


def case_options_from_action(case_action: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    options: List[Dict[str, Any]] = []
    if not case_action:
        return options
    for case in case_action.get("cases") or []:
        digit = clean_text(case.get("value") or case.get("name"))
        target = clean_text(case.get("target"))
        if digit:
            options.append({"digit": digit, "targetActionId": target, "source": "CASE", "case": case})
    return options


def follow_menu_dispatch_chain(menu_action: Optional[Dict[str, Any]], execution_model: Dict[str, Any]) -> Dict[str, Any]:
    if not menu_action:
        return {"path": [], "dispatcherActionId": "", "caseActionId": "", "caseAction": None}
    actions = execution_model.get("actionsById") or {}
    edges_by_source = execution_model.get("edgesBySource") or {}
    current_id = clean_text(menu_action.get("actionId"))
    path: List[str] = []
    dispatcher_id = ""
    case_action_id = ""
    visited = set()
    while current_id and current_id not in visited and len(path) < 12:
        visited.add(current_id)
        path.append(current_id)
        action = actions.get(current_id)
        if not action:
            break
        atype = clean_text(action.get("type")).upper()
        code = action_code(action)
        if current_id != clean_text(menu_action.get("actionId")) and not dispatcher_id and parse_switch_case_tree(code):
            dispatcher_id = current_id
        if atype == "CASE":
            case_action_id = current_id
            break
        edges = edges_by_source.get(current_id) or []
        preferred = None
        if atype == "MENU":
            preferred = next((edge for edge in edges if edge.get("executionKind") in {"menu_default", "default"}), None)
        elif atype == "LOCATE":
            preferred = next((edge for edge in edges if edge.get("executionKind") == "locate_found"), None)
        else:
            preferred = next((edge for edge in edges if edge.get("executionKind") in {"default", "case", "decision_branch"} and not edge.get("sideTreatment")), None)
        if not preferred:
            preferred = next((edge for edge in edges if not edge.get("sideTreatment")), None)
        if not preferred:
            break
        current_id = clean_text(preferred.get("target"))
    return {
        "path": path,
        "dispatcherActionId": dispatcher_id,
        "caseActionId": case_action_id,
        "caseAction": actions.get(case_action_id) if case_action_id else None,
    }


def extract_menu_options_from_execution(menu_action: Optional[Dict[str, Any]], execution_model: Dict[str, Any], context: Optional[ExecutionContext] = None) -> List[Dict[str, Any]]:
    if not menu_action:
        return []
    context = context or ExecutionContext()
    menu_id = clean_text(menu_action.get("actionId"))
    options: List[Dict[str, Any]] = []
    seen: Set[str] = set()

    def add_option(digit: Any, target: Any = "", source: str = "", case_data: Optional[Dict[str, Any]] = None) -> None:
        value = clean_text(digit)
        if not value or value in seen:
            return
        seen.add(value)
        assignments = (case_data or {}).get("assignments") or {}
        ctx = context.clone()
        ctx.path_digits.append(value)
        capture_var = clean_text(menu_variable(menu_action.get("parameters")) or "MRES")
        if capture_var:
            ctx.current_menu_variable = capture_var
            ctx.set(capture_var, value)
        ctx.apply_assignments(assignments)
        audio_value = assignment_value(assignments, ["AUDIO", "audio", "NOTEMENU", "noteini", "noteinc", "noteINV", "notesil", "noteREJ", "menu_audio1", "menu_audio2", "audio_menu1", "audio_menu2", "audio_menu3"])
        next_step = assignment_value(assignments, ["NEXT_STEP", "next_step", "nextStep"])
        transfer_code = assignment_value(assignments, ["TRANSFERCODE", "TransferCode", "transferCode"])
        label_seed = subject_from_skill_name(clean_text(ctx.get("SKILL_NAME"))) or audio_subject_from_path(resolve_value_from_context(audio_value, ctx)) or clean_flow_target_value(resolve_value_from_context(next_step, ctx)) or f"Opcao {value}"
        options.append(
            {
                "digit": value,
                "label": short_label(label_seed, 70),
                "description": "Opcao real detectada por CASE/MASCARA/SWITCH do XML NICE.",
                "targetActionId": clean_text(target),
                "source": source,
                "case": case_data or {},
                "audio": resolve_value_from_context(audio_value, ctx),
                "nextStep": clean_flow_target_value(resolve_value_from_context(next_step, ctx)),
                "transferCode": clean_flow_target_value(resolve_value_from_context(transfer_code, ctx)),
                "executionContext": ctx.snapshot(),
                "evidence": [f"MENU ActionID {menu_id}", source],
            }
        )

    chain = follow_menu_dispatch_chain(menu_action, execution_model)
    case_action = chain.get("caseAction")
    for item in case_options_from_action(case_action):
        add_option(item.get("digit"), item.get("targetActionId"), f"CASE ActionID {clean_text((case_action or {}).get('actionId'))}", item.get("case"))

    if not options:
        for value in parse_mask_options_from_text(action_code(execution_model.get("actionsById", {}).get(chain.get("dispatcherActionId")) or {})):
            add_option(value, chain.get("dispatcherActionId"), "MASCARA")

    if not options:
        dispatcher = execution_model.get("actionsById", {}).get(chain.get("dispatcherActionId"))
        for item in parse_switch_case_tree(action_code(dispatcher or {})):
            for value in item.get("caseValues") or []:
                add_option(value, clean_text((dispatcher or {}).get("actionId")), f"SWITCH ActionID {clean_text((dispatcher or {}).get('actionId'))}", item)

    if not options:
        for case in menu_action.get("cases") or []:
            add_option(case.get("value") or case.get("name"), case.get("target"), "MENU.Cases", case)
    return options


def build_execution_model(raw_actions: Dict[str, Any], semantic_model: Dict[str, Any], pre_semantic_extract: Dict[str, Any]) -> Dict[str, Any]:
    actions_map, adjacency, incoming = build_navigation_maps(semantic_model)
    start_action = next((action for action in semantic_model.get("actions", []) if clean_text(action.get("type")).upper() == "BEGIN"), None)
    assignments_by_action: Dict[str, Dict[str, str]] = {}
    audio_assignments: Dict[str, Dict[str, str]] = {}
    next_step_assignments: Dict[str, str] = {}
    transfer_codes: Dict[str, str] = {}
    cases: Dict[str, Any] = {}
    loops: Dict[str, Any] = {}
    edges_by_source: Dict[str, List[Dict[str, Any]]] = {}
    technical_events: List[Dict[str, Any]] = []

    for aid, action in actions_map.items():
        assignments = parse_assignments(action_code(action))
        output = summarize_action_output(action)
        assignments_by_action[aid] = assignments
        audio_assignments[aid] = {key: value for key, value in assignments.items() if is_audio_context_key(key)}
        if output.get("nextStep"):
            next_step_assignments[aid] = output["nextStep"]
        if output.get("transferCode"):
            transfer_codes[aid] = output["transferCode"]
        if clean_text(action.get("type")).upper() == "CASE":
            cases[aid] = {"cases": case_options_from_action(action), "incoming": incoming.get(aid, 0)}
        if clean_text(action.get("type")).upper() == "LOOP":
            loops[aid] = {
                "caption": clean_text(action.get("caption")),
                "repeatTargets": [clean_text(edge.get("target")) for edge in adjacency.get(aid, []) if "repeat" in edge_label_text(edge).lower()],
                "finishedTargets": [clean_text(edge.get("target")) for edge in adjacency.get(aid, []) if edge_label_text(edge).lower() in {"finished", "limit", "limite"}],
            }
        for edge in adjacency.get(aid, []):
            kind = edge_execution_kind(action, edge)
            edges_by_source.setdefault(aid, []).append({**edge, "executionKind": kind, "sideTreatment": kind == "side_treatment"})

    model: Dict[str, Any] = {
        "startActionId": clean_text((start_action or {}).get("actionId")),
        "actionsById": actions_map,
        "edgesBySource": edges_by_source,
        "menus": {},
        "cases": cases,
        "loops": loops,
        "assignmentsByAction": assignments_by_action,
        "audioAssignments": audio_assignments,
        "nextStepAssignments": next_step_assignments,
        "transferCodes": transfer_codes,
        "technicalEvents": technical_events,
        "parser": URA_DOCS_PARSER_NAME,
        "parserVersion": URA_DOCS_PARSER_VERSION,
    }
    for action in semantic_model.get("actions", []):
        if clean_text(action.get("type")).upper() != "MENU":
            continue
        ctx = ExecutionContext()
        menu_id = clean_text(action.get("actionId"))
        chain = follow_menu_dispatch_chain(action, model)
        model["menus"][menu_id] = {
            "actionId": menu_id,
            "caption": clean_text(action.get("caption")),
            "captureVariable": menu_variable(action.get("parameters")),
            "dispatcherPath": chain.get("path") or [],
            "dispatcherActionId": chain.get("dispatcherActionId"),
            "caseActionId": chain.get("caseActionId"),
            "options": extract_menu_options_from_execution(action, model, ctx),
        }
    return model


def humanize_if_condition(action: Dict[str, Any], ai_organizer: Dict[str, Any]) -> str:
    return humanize_if_for_display(action, ai_organizer)[0]


def _legacy_humanize_if_condition(action: Dict[str, Any], ai_organizer: Dict[str, Any]) -> str:
    aid = clean_text(action.get("actionId"))
    for item in ai_organizer.get("ifLabels", []) or []:
        if isinstance(item, dict) and clean_text(item.get("actionId")) == aid:
            value = clean_text(item.get("humanQuestion") or item.get("condition"))
            if value:
                return value
    text = " ".join([clean_text(action.get("caption")), action_code(action)]).lower()
    if "checkmobile" in text or "celcancel" in text or "celular" in text:
        return "Celular informado e valido?"
    if "checkcpf" in text or "cpfcancel" in text or "cpf" in text:
        return "CPF informado e valido?"
    if "transfer_skill" in text or "transfer skill" in text:
        return "Deve transferir direto para skill?"
    if "ani" in text and ("bloq" in text or "block" in text):
        return "ANI bloqueado?"
    if "finaldesemana" in text or "feriado" in text or "horario" in text or "indispon" in text:
        return "URA esta disponivel?"
    caption = clean_text(action.get("caption")) or f"IF {aid}"
    return short_label(caption, 80) + "?"


def human_branch_label(label: Any) -> str:
    raw = clean_text(label)
    low = raw.lower()
    if low in {"true", "verdadeiro", "sim"}:
        return "Sim"
    if low in {"false", "falso", "nao", "não"}:
        return "Nao"
    if low == "finished":
        return "Limite atingido"
    if low == "repeat":
        return "Repete tentativa"
    if "timeout" in low:
        return "Silencio/timeout"
    if "interdigit" in low:
        return "Timeout entre digitos"
    if "maxdigit" in low or "invalid" in low or "inval" in low:
        return "Opcao invalida"
    if low == "open":
        return "Aberto"
    if low == "closed":
        return "Fechado"
    if low == "holiday":
        return "Feriado"
    if low in {"meeting", "emergency"}:
        return "Reuniao/Emergencia"
    return edge_label({"label": raw})


def is_hours_action(action: Optional[Dict[str, Any]]) -> bool:
    return clean_text((action or {}).get("type")).upper() == "HOURS"


def hours_key(action: Optional[Dict[str, Any]]) -> str:
    parameters = (action or {}).get("parameters") or []
    if isinstance(parameters, list) and parameters:
        value = clean_text(parameters[0])
        if value:
            return value
    code = action_code(action or {})
    match = re.search(r"\b(\d{1,4})\b", code)
    if match:
        return match.group(1)
    return clean_text((action or {}).get("actionId"))


def human_hours_branch_label(label: Any) -> str:
    raw = clean_text(label)
    low = raw.lower()
    mapping = {
        "open": "Aberto",
        "aberto": "Aberto",
        "closed": "Fechado",
        "fechado": "Fechado",
        "holiday": "Feriado",
        "feriado": "Feriado",
        "meeting": "Reunião",
        "reuniao": "Reunião",
        "reunião": "Reunião",
        "emergency": "Emergência",
        "emergencia": "Emergência",
        "emergência": "Emergência",
    }
    if low in mapping:
        return mapping[low]
    return clean_option_label_token(raw) or human_branch_label(raw)


def is_open_hours_branch(label: Any) -> bool:
    return clean_text(label).lower() in {"open", "aberto"}


def is_unavailable_hours_branch(label: Any) -> bool:
    return clean_text(label).lower() in {
        "closed",
        "holiday",
        "feriado",
        "fechado",
        "meeting",
        "emergency",
        "reuniao",
        "reunião",
        "emergencia",
        "emergência",
    }


def hours_display_label(action: Optional[Dict[str, Any]]) -> str:
    key = hours_key(action)
    return f"Horário {key}" if key else "Valida horário"


def humanize_hours_play(action: Dict[str, Any], audio: Dict[str, Any]) -> str:
    text = " ".join([clean_text(action.get("caption")), clean_text(audio.get("fileName")), action_code(action)]).lower()
    if any(token in text for token in ["feriado", "holiday"]):
        return "Áudio de feriado"
    if any(token in text for token in ["reuniao", "reunião", "meeting", "emergencia", "emergência", "emergency"]):
        return "Áudio de reunião/emergência"
    if any(token in text for token in ["semexpediente", "sem_expediente", "fora_horario", "forahorario", "fechado", "indisponivel", "indisponível"]):
        return "Áudio fechado ou fora de horário"
    return "Áudio de indisponibilidade"


GENERIC_TECHNICAL_LABELS = {
    "if",
    "play",
    "begin",
    "snippet",
    "case",
    "menu",
    "runscript",
    "runsub",
    "restapi",
    "rest_api",
    "action",
    "locate",
    "loop",
    "assign",
    "hours",
    "end",
}


def is_generic_technical_label(label: Any) -> bool:
    text = re.sub(r"[^a-z0-9_]+", "", clean_text(label).lower())
    return (
        not text
        or text in GENERIC_TECHNICAL_LABELS
        or text.startswith("nextstep")
        or text.startswith("next_step")
        or re.fullmatch(r"(if|play|begin|snippet|case|menu|action)\d*", text) is not None
    )


def ai_display_label_for_action(action_id: str, ai_organizer: Dict[str, Any]) -> Dict[str, Any]:
    for item in ai_organizer.get("displayLabels", []) or []:
        if isinstance(item, dict) and clean_text(item.get("actionId")) == action_id:
            return item
    for item in ai_organizer.get("navigationLabels", []) or []:
        if isinstance(item, dict) and clean_text(item.get("actionId")) == action_id:
            return {
                "displayLabel": clean_text(item.get("humanLabel")),
                "businessDescription": clean_text(item.get("description")),
                "evidence": item.get("evidence") or [],
            }
    return {}


def condition_label_for_action(action: Dict[str, Any]) -> str:
    code = action_code(action)
    lines = [clean_text(line) for line in code.splitlines() if clean_text(line)]
    condition = lines[0] if lines else clean_text(action.get("caption"))
    condition = re.sub(r"\s+", " ", condition)
    return short_label(condition, 120)


def humanize_if_for_display(action: Dict[str, Any], ai_organizer: Dict[str, Any]) -> Tuple[str, str]:
    aid = clean_text(action.get("actionId"))
    ai_label = ai_display_label_for_action(aid, ai_organizer)
    if clean_text(ai_label.get("displayLabel")) and not is_generic_technical_label(ai_label.get("displayLabel")):
        return clean_text(ai_label.get("displayLabel")), clean_text(ai_label.get("conditionLabel")) or condition_label_for_action(action)
    for item in ai_organizer.get("ifLabels", []) or []:
        if isinstance(item, dict) and clean_text(item.get("actionId")) == aid:
            value = clean_text(item.get("humanQuestion"))
            if value and not is_generic_technical_label(value):
                return value, clean_text(item.get("rawCondition")) or condition_label_for_action(action)
    code = action_code(action)
    text = " ".join([clean_text(action.get("caption")), code]).lower()
    condition = condition_label_for_action(action)
    if "checkmobile" in text or "celcancel" in text or "celular" in text:
        return "Celular informado e valido?", condition
    if "checkcpf" in text or "cpfcancel" in text or "cpf" in text:
        return "CPF informado e valido?", condition
    if "transfer_skill" in text or "transfer skill" in text:
        return "Deve transferir direto para a skill?", condition
    if "portal_renegociacao" in text or "renegociacao" in text:
        return "Cliente esta elegivel para renegociacao?", condition
    if "antifraude" in text:
        return "Cliente passa na validacao antifraude?", condition
    if "consulta" in text and "ret" in text and "ok" in text:
        return "Consulta retornou OK?", condition
    if "ani" in text and ("bloq" in text or "block" in text or "=" in text):
        return "ANI bloqueado?", condition
    if any(token in text for token in ["finaldesemana", "feriado", "horario", "indispon", "closed", "holiday"]):
        return "URA indisponivel?", condition
    return short_label(clean_text(action.get("caption")) or "Validacao", 70) + "?", condition


def friendly_action_label(action: Dict[str, Any], ai_organizer: Dict[str, Any]) -> str:
    aid = clean_text(action.get("actionId"))
    atype = clean_text(action.get("type")).upper()
    ai_label = ai_display_label_for_action(aid, ai_organizer)
    value = clean_text(ai_label.get("displayLabel"))
    if value and not is_generic_technical_label(value):
        return value
    if atype == "IF":
        return humanize_if_for_display(action, ai_organizer)[0]
    if atype == "BEGIN":
        return "Inicio da URA"
    if atype == "HOURS":
        return hours_display_label(action)
    if atype == "PLAY":
        return "Mensagem de audio"
    if atype == "MENU":
        return "Menu de coleta" if is_collect_action(action) else "Menu principal"
    output = summarize_action_output(action)
    if atype == "CASE":
        return "Direciona opcao escolhida"
    if atype == "LOCATE":
        return "Valida opcao digitada"
    if atype == "LOOP":
        return "Controle de tentativas"
    if atype == "ASSIGN":
        if output.get("nextStep"):
            return "Define proximo destino"
        return "Atualiza variaveis do fluxo"
    if atype == "SNIPPET":
        if output.get("scriptpoint") or output.get("mapaDna"):
            return "Registra CDR / rastreio"
        if output.get("nextStep") and output.get("audio"):
            return "Define mensagem e proximo destino"
        if output.get("nextStep"):
            return "Define proximo destino"
        if output.get("audio"):
            return "Define audio da navegacao"
        return "Processamento da regra"
    if atype == "RUNSCRIPT":
        return "Executa proximo destino"
    if atype in {"RUNSUB", "REST_API"}:
        return "Consulta API / integracao"
    if atype == "REQAGENT":
        return "Transfere para atendimento"
    if atype == "END":
        return "Encerrar chamada"
    for item in ai_organizer.get("actionAnnotations", []) or []:
        if isinstance(item, dict) and clean_text(item.get("actionId")) == aid:
            candidate = clean_text(item.get("businessLabel") or item.get("shortLabel"))
            if candidate and not is_generic_technical_label(candidate):
                return candidate
    caption = clean_text(action.get("caption"))
    return short_label(caption if caption and not is_generic_technical_label(caption) else atype.title(), 70)


def branch_meaning(raw_label: Any, semantic_model: Dict[str, Any], target_action_id: str) -> str:
    label = human_branch_label(raw_label)
    action = action_by_id(semantic_model).get(clean_text(target_action_id))
    target_type = clean_text((action or {}).get("type")).upper()
    target_text = action_search_text(action)
    if target_type == "END" or "desliga" in target_text or "tchau" in target_text:
        return f"{label}: encerra chamada"
    if target_type == "PLAY":
        return f"{label}: executa mensagem"
    if target_type in {"RUNSCRIPT", "RUNSUB", "REST_API"}:
        return f"{label}: direciona para integracao/proximo fluxo"
    if target_type == "MENU":
        return f"{label}: segue para menu"
    if label in {"Sim", "Aberto"}:
        return f"{label}: segue no fluxo"
    if label in {"Nao", "Fechado", "Feriado", "Reuniao/Emergencia"}:
        return f"{label}: tratamento alternativo"
    return label


def clean_display_text(value: Any) -> str:
    text = clean_text(value)
    text = re.sub(r"\b(?:Ref\.?\s*:?\s*)?ActionID\s*\d+\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bRef\.?\s*:?", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bCondicao\s*:\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bOrigem\s*:\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bDestino\s*:\s*ActionID\s*\d+\b", "", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip(" -:\n\t")


def humanize_if_short(action: Dict[str, Any], ai_organizer: Dict[str, Any]) -> Tuple[str, str]:
    label, condition = humanize_if_for_display(action, ai_organizer)
    condition = clean_display_text(condition)
    text = " ".join([clean_text(action.get("caption")), action_code(action)]).lower()
    simple_condition = re.sub(r"\s+", "", condition)
    if simple_condition and re.fullmatch(r"[A-Za-z0-9_:.-]+[=!<>]+[A-Za-z0-9_+.:\"'-]+", simple_condition):
        return condition, condition
    if "checkmobile" in text or "celcancel" in text or "celular" in text:
        return "Celular valido?", condition
    if "checkcpf" in text or "cpfcancel" in text or "cpf" in text:
        return "CPF valido?", condition
    if "consultarconsumobandalarga_ret" in text:
        return "API consumo OK?", condition
    if "consultacarto_ret" in text or "carto_ret" in text:
        return "Consulta cartao OK?", condition
    if "transfer_skill" in text or "transfer skill" in text:
        return "Transferir para skill?", condition
    if "ani" in text and ("=" in text or "bloq" in text or "block" in text):
        return condition or "ANI bloqueado?", condition
    return clean_display_text(label), condition


def humanize_collect_menu(action: Dict[str, Any], semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any]) -> str:
    audio = best_audio_for_display_node(action, semantic_model, ai_organizer).get("fileName", "")
    text = " ".join([action_search_text(action), clean_text(audio)]).lower()
    if any(token in text for token in ["cpf", "cpfcancel"]):
        return "Digitar CPF"
    if any(token in text for token in ["cel", "celular", "celcancel", "mobile", "telefone"]):
        return "Digitar celular"
    if any(token in text for token in ["cartao", "cartão", "card"]):
        return "Digitar cartao"
    if "protocolo" in text:
        return "Digitar protocolo"
    return "Informar dados"


def best_audio_for_display_node(action: Optional[Dict[str, Any]], semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any]) -> Dict[str, str]:
    if not action:
        return {"fileName": "", "transcription": "", "origin": ""}
    aid = clean_text(action.get("actionId"))
    for item in ai_organizer.get("audioLabels", []) or []:
        if isinstance(item, dict) and clean_text(item.get("actionId")) == aid and clean_text(item.get("fileName")):
            return {"fileName": clean_text(item.get("fileName")), "transcription": "", "origin": "IA"}
    audio = {"fileName": "", "transcription": "", "origin": ""}
    trace_context: Dict[str, str] = {}
    for reference in action_audio_references(action):
        audio = resolve_audio_with_trace_context(reference, trace_context, semantic_model, f"ActionID {aid}")
        if clean_text(audio.get("fileName")) or clean_text(audio.get("mode")) == "dynamic":
            break
    if not clean_text(audio.get("fileName")) and clean_text(audio.get("mode")) != "dynamic":
        direct = audio_context_for_action(action, semantic_model)
        if clean_text(direct.get("fileName")) and not is_auxiliary_audio_file(direct.get("fileName")):
            audio = direct
    if audio.get("fileName"):
        resolved = resolve_audio_reference(aid, audio.get("fileName"), semantic_model)
        return {**audio, "fileName": clean_text(resolved or audio.get("fileName"))}
    output = summarize_action_output(action)
    for value in [
        output.get("audio"),
        first_assignment(parse_assignments(action_code(action)), ["NOTEMENU", "noteini", "noteinc", "noterej", "notesil", "noteINV", "menu_audio1", "menu_audio2", "audio_menu1", "audio_menu2", "audio_menu3"]),
    ]:
        if clean_text(value):
            return {"fileName": resolve_audio_reference(aid, value, semantic_model), "transcription": "", "origin": f"ActionID {aid}"}
    return {"fileName": "", "transcription": "", "origin": ""}


def should_hide_from_main_flow(action: Optional[Dict[str, Any]], display_node: Optional[Dict[str, Any]] = None) -> bool:
    if display_node and display_node.get("hideFromMainFlow") is True:
        return True
    if not action:
        return False
    atype = clean_text(action.get("type")).upper()
    if atype in {"ONRELEASE", "ONANSWER"}:
        return True
    output = summarize_action_output(action)
    text = action_search_text(action)
    has_functional_output = any(output.get(key) for key in ["audio", "nextStep", "transferCode", "skillId", "skillName"])
    if atype == "SNIPPET":
        if (output.get("scriptpoint") or output.get("mapaDna")) and not has_functional_output:
            return True
        if any(token in text for token in ["scriptpoint", "mapa_dna", "marca_cdr", "dados_cdr"]) and not has_functional_output:
            return True
        if "config_menu" in text and not has_functional_output:
            return True
        if "set_params" in text and not has_functional_output:
            return True
    return False


def build_display_node_from_action(action: Dict[str, Any], semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any]) -> Dict[str, Any]:
    aid = clean_text(action.get("actionId"))
    atype = clean_text(action.get("type")).upper()
    ai_label = ai_display_label_for_action(aid, ai_organizer)
    audio = best_audio_for_display_node(action, semantic_model, ai_organizer)
    secondary = clean_display_text(ai_label.get("secondaryLabel"))
    condition = ""
    if atype == "IF":
        label, condition = humanize_if_short(action, ai_organizer)
    elif atype == "HOURS":
        condition = ""
        label = hours_display_label(action)
    elif atype == "MENU" and is_collect_action(action):
        label = humanize_collect_menu(action, semantic_model, ai_organizer)
    elif atype == "MENU":
        caption = clean_display_text(action.get("caption"))
        if any(token in caption.lower() for token in ["sauda", "saudacao", "saudação", "menu inicial", "menuinicial"]):
            label = f"Menu principal - {caption}"
        else:
            label = friendly_action_label(action, ai_organizer)
    elif atype == "PLAY":
        subject = audio_subject_from_path(audio.get("fileName"))
        label = f"Audio {subject}" if subject else "Mensagem de audio"
    elif atype == "SNIPPET":
        output = summarize_action_output(action)
        subject = audio_subject_from_path(audio.get("fileName"))
        if output.get("audio") or audio.get("fileName"):
            label = f"Preparar audio de {subject}" if subject else "Preparar audio"
        elif output.get("nextStep"):
            label = "Define proximo destino"
        elif output.get("scriptpoint") or output.get("mapaDna"):
            label = ""
        else:
            label = friendly_action_label(action, ai_organizer)
    else:
        label = clean_display_text(ai_label.get("displayLabel")) or friendly_action_label(action, ai_organizer)
    label = clean_display_text(label)
    if is_generic_technical_label(label):
        label = friendly_action_label(action, ai_organizer)
    node = {
        "nodeKey": f"{atype.lower()}_{aid}",
        "actionId": aid,
        "type": atype,
        "displayLabel": clean_display_text(label),
        "secondaryLabel": secondary,
        "conditionLabel": clean_display_text(condition),
        "audio": audio,
        "showTechnicalRef": False,
        "hideFromMainFlow": should_hide_from_main_flow(action, ai_label),
        "hideCondition": atype == "HOURS",
        "evidence": [f"ActionID {aid}"],
    }
    if not node["displayLabel"] and should_hide_from_main_flow(action, node):
        node["hideFromMainFlow"] = True
    return node


def render_main_flow_display_node(display_node: Dict[str, Any], options: Optional[List[Dict[str, Any]]] = None) -> str:
    lines = []
    label = clean_display_text(display_node.get("displayLabel"))
    if label:
        lines.append(short_label(label, 62))
    secondary = clean_display_text(display_node.get("secondaryLabel"))
    if secondary and not display_node.get("hideCondition") and should_render_condition(label, secondary):
        lines.append(short_label(secondary, 62))
    condition = clean_display_text(display_node.get("conditionLabel"))
    if not display_node.get("hideCondition") and should_render_condition(label, condition):
        lines.append(short_label(condition, 62))
    audio = display_node.get("audio") or {}
    audio_line = render_audio_line(audio)
    if audio_line:
        lines.append(audio_line)
    for option in (options or [])[:8]:
        digit = clean_text(option.get("digit"))
        opt_label = clean_display_text(option.get("label"))
        if digit or opt_label:
            lines.append(short_label(f"{digit} {opt_label}".strip(), 62))
    return "\n".join(unique_visual_lines(lines))


def comparable_condition_text(value: Any) -> str:
    text = clean_display_text(value).lower()
    text = re.sub(r"[ãáàâä]", "a", text)
    text = re.sub(r"[éèêë]", "e", text)
    text = re.sub(r"[íìîï]", "i", text)
    text = re.sub(r"[óòôö]", "o", text)
    text = re.sub(r"[úùûü]", "u", text)
    text = re.sub(r"[ç]", "c", text)
    return re.sub(r"[^a-z0-9]+", "", text)


def normalize_condition_text(value: Any) -> str:
    text = clean_display_text(value).lower()
    text = text.replace("'", "\"").replace("“", "\"").replace("”", "\"")
    text = re.sub(r"\s*(?:==|=|!=|<>|>=|<=|>|<)\s*", "=", text)
    return comparable_condition_text(text)


def should_render_condition(display_label: Any, condition_label: Any) -> bool:
    label_norm = normalize_condition_text(display_label)
    condition_norm = normalize_condition_text(condition_label)
    if not condition_norm:
        return False
    if condition_norm == label_norm:
        return False
    if label_norm and (condition_norm in label_norm or label_norm in condition_norm):
        return False
    if "checkcpf" in condition_norm and "cpfvalido" in label_norm:
        return False
    if "checkmobile" in condition_norm and "celularvalido" in label_norm:
        return False
    if "celular" in label_norm and any(token in condition_norm for token in ["cel1", "checkmobile", "mobile"]):
        return False
    if "digitarcelular" in label_norm and "cel1" in condition_norm:
        return False
    if "cpf" in label_norm and "checkcpf" in condition_norm:
        return False
    if "transferskill" in condition_norm and "transfer" in label_norm:
        return False
    if condition_norm.isdigit() and condition_norm in label_norm:
        return False
    return True


def unique_visual_lines(lines: List[Any]) -> List[str]:
    result: List[str] = []
    seen = set()
    for line in lines:
        text = clean_text(line)
        if not text:
            continue
        key = normalize_condition_text(text)
        if key in seen:
            continue
        seen.add(key)
        result.append(text)
    return result


def build_display_nodes(navigation_story: Dict[str, Any], semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any]) -> Dict[str, Any]:
    actions_map = action_by_id(semantic_model)

    def convert_item(item: Dict[str, Any]) -> Dict[str, Any]:
        action = actions_map.get(clean_text(item.get("actionId")))
        if action:
            node = build_display_node_from_action(action, semantic_model, ai_organizer)
        else:
            node = {
                "nodeKey": clean_text(item.get("nodeKey")),
                "actionId": clean_text(item.get("actionId")),
                "type": clean_text(item.get("type")),
                "displayLabel": clean_display_text(item.get("displayLabel") or item.get("label")),
                "secondaryLabel": clean_display_text(item.get("secondaryLabel")),
                "conditionLabel": clean_display_text(item.get("conditionLabel")),
                "audio": item.get("audio") or {},
                "showTechnicalRef": False,
                "hideFromMainFlow": bool(item.get("hideFromMainFlow")),
                "hideCondition": bool(item.get("hideCondition")),
                "technicalCondition": clean_text(item.get("technicalCondition")),
                "evidence": item.get("evidence") or [],
            }
        node["branches"] = item.get("branches") or []
        node["hoursKey"] = item.get("hoursKey")
        node["mainBranch"] = item.get("mainBranch") or {}
        node["sideBranches"] = item.get("sideBranches") or []
        node["options"] = item.get("options") or []
        return node

    pre_menu = [convert_item(item) for item in navigation_story.get("preMenu", []) if isinstance(item, dict)]
    main_menu = convert_item(navigation_story.get("mainMenu") or {})
    main_menu["options"] = (navigation_story.get("mainMenu") or {}).get("options") or []
    option_flows = []
    for flow_item in navigation_story.get("optionFlows", []) or []:
        if not isinstance(flow_item, dict):
            continue
        option_flows.append(
            {
                **flow_item,
                "displayLabel": clean_display_text(flow_item.get("label")),
                "rawSteps": [convert_item(step) for step in flow_item.get("rawSteps", []) if isinstance(step, dict)],
                "visibleSteps": [convert_item(step) for step in flow_item.get("visibleSteps", []) if isinstance(step, dict)],
                "steps": [convert_item(step) for step in (flow_item.get("visibleSteps") or flow_item.get("steps") or []) if isinstance(step, dict)],
            }
        )
    return {
        "preMenu": pre_menu,
        "mainMenu": main_menu,
        "optionFlows": option_flows,
        "sideEvents": navigation_story.get("sideEvents") or [],
        "endings": navigation_story.get("endings") or [],
    }


def build_pre_semantic_extract(raw_actions: Dict[str, Any]) -> Dict[str, Any]:
    actions = raw_actions.get("actions", [])
    menus = []
    ifs = []
    snippets = []
    prompts = []
    integrations = []
    skills = []
    cdr = []
    for action in actions:
        if not isinstance(action, dict):
            continue
        aid = clean_text(action.get("actionId"))
        atype = clean_text(action.get("type")).upper()
        caption = clean_text(action.get("caption"))
        code = "\n".join(clean_text(item) for item in action.get("parameters") or [])
        output = summarize_action_output(action)
        if atype == "MENU":
            menus.append(
                {
                    "actionId": aid,
                    "caption": caption,
                    "captureVariable": menu_variable(action.get("parameters")),
                    "cases": action.get("cases") or [],
                    "branches": action.get("branches") or [],
                    "prompts": iter_action_audio_paths(action),
                }
            )
        if atype == "IF":
            ifs.append(
                {
                    "actionId": aid,
                    "caption": caption,
                    "condition": short_label(code or caption, 300),
                    "branches": action.get("branches") or [],
                    "defaultNextAction": action.get("defaultNextAction"),
                }
            )
        parsed_cases = parse_switch_case_tree(code)
        if parsed_cases:
            snippets.append(
                {
                    "sourceActionId": aid,
                    "caption": caption,
                    "type": atype,
                    "cases": parsed_cases,
                    "assignments": parse_assignments_in_block(code),
                }
            )
        for audio_path in iter_action_audio_paths(action):
            prompts.append({"sourceActionId": aid, "caption": caption, "fileName": re.split(r"[\\/]", clean_text(audio_path))[-1], "fullPath": audio_path})
        if output.get("skillId") or output.get("skillName"):
            skills.append({"sourceActionId": aid, "skillId": output.get("skillId"), "skillName": output.get("skillName"), "evidence": [f"ActionID {aid}"]})
        if output.get("scriptpoint") or output.get("mapaDna"):
            cdr.append({"sourceActionId": aid, "scriptpoint": output.get("scriptpoint"), "mapaDna": output.get("mapaDna")})
        if atype in {"RUNSCRIPT", "RUNSUB", "REST_API", "REQAGENT", "ONANSWER", "ONRELEASE"} or output.get("nextStep") or output.get("transferCode"):
            integrations.append({"actionId": aid, "type": atype, "caption": caption, **output})
    return {
        "project": raw_actions.get("project") or {},
        "menus": menus,
        "ifs": ifs,
        "snippets": snippets,
        "prompts": prompts,
        "skills": skills,
        "integrations": integrations,
        "cdrScriptpoints": cdr,
        "edges": raw_actions.get("edges", []),
    }


def is_functional_route_row(row: Dict[str, Any]) -> bool:
    if row.get("kind") in {"prompt", "technical_detail"}:
        return False
    text = " ".join(
        clean_text(row.get(key))
        for key in ["category", "treatment", "sourceCaption", "audio", "nextStep", "skillName", "scriptpoint", "mapaDna"]
    ).lower()
    technical_tokens = ["scriptpoint", "mapa_dna", "set_params", "max_sil", "maxsil", "max_inv", "maxinc", "config_menu", "check-cpf", "check-mobile", "dados_cdr"]
    if any(token in text for token in technical_tokens) and not any(row.get(key) for key in ["skillId", "skillName", "nextStep", "transferCode"]):
        return False
    return bool(row.get("caseValues") or row.get("skillId") or row.get("skillName") or row.get("nextStep") or row.get("transferCode") or row.get("target"))


def build_human_routes(raw_actions: Dict[str, Any], pre_semantic_extract: Dict[str, Any], ai_organizer: Dict[str, Any], semantic_model: Dict[str, Any]) -> Dict[str, Any]:
    rows = [row for row in semantic_rows(semantic_model) if is_functional_route_row(row)]
    menu_label_index = {
        clean_text(item.get("menuActionId")): item
        for item in ai_organizer.get("menuLabels", []) or []
        if isinstance(item, dict)
    }
    action_label_index = {
        clean_text(item.get("actionId")): item
        for item in ai_organizer.get("actionAnnotations", []) or ai_organizer.get("actionLabels", []) or []
        if isinstance(item, dict)
    }
    routes = []
    seen = set()
    for row in rows:
        case_values = [clean_text(item) for item in row.get("caseValues") or [] if clean_text(item)]
        case_range = clean_text(row.get("caseRangeLabel"))
        path = [case_range] if case_range and len(case_values) > 1 else case_values
        if not path and row.get("kind") == "menu_case":
            path = [clean_text(row.get("target")) or str(len(routes) + 1)]
        label = clean_text(row.get("treatment") or row.get("category") or row.get("skillName") or row.get("nextStep") or "Rota")
        action_id = clean_text(row.get("sourceActionId"))
        ann = action_label_index.get(action_id, {})
        if clean_text(ann.get("shortLabel")) and label.lower().startswith("opcao "):
            label = clean_text(ann.get("shortLabel"))
        menu_ai = menu_label_index.get(action_id, {})
        for option in menu_ai.get("options", []) or []:
            if clean_text(option.get("digit")) in case_values and clean_text(option.get("label")):
                label = clean_text(option.get("label"))
                break
        key = (action_id, "|".join(path), label, clean_text(row.get("skillId")), clean_text(row.get("nextStep")), clean_text(row.get("target")))
        if key in seen:
            continue
        seen.add(key)
        target_type = "skill" if row.get("skillId") or row.get("skillName") else "next_step" if row.get("nextStep") else "action"
        prompt = ""
        prompt_transcription = ""
        for item in semantic_model.get("prompts", []):
            if clean_text(item.get("sourceActionId")) == action_id:
                prompt = clean_text(item.get("fileName"))
                prompt_transcription = clean_text(item.get("transcription"))
                break
        routes.append(
            {
                "routeId": f"R{len(routes) + 1:03d}",
                "path": path,
                "pathLabel": " > ".join([clean_text(item) for item in [*path, label] if clean_text(item)]),
                "group": clean_text(row.get("category") or ann.get("group") or "Jornada"),
                "domain": clean_text(row.get("category")),
                "treatment": label,
                "originMenuActionId": action_id,
                "sourceActionIds": [action_id] if action_id else [],
                "target": {
                    "type": target_type,
                    "skillId": clean_text(row.get("skillId")),
                    "skillName": clean_text(row.get("skillName")),
                    "actionId": clean_text(row.get("target")),
                },
                "prompt": {"fileName": prompt or clean_text(row.get("audio")), "transcription": prompt_transcription},
                "nextStep": clean_text(row.get("nextStep")),
                "scriptpoint": clean_text(row.get("scriptpoint")),
                "mapaDna": clean_text(row.get("mapaDna")),
                "transferCode": clean_text(row.get("transferCode")),
                "evidence": [f"ActionID {action_id}", f"CASE {_case_range_label(case_values) or '/'.join(path)}"],
                "confidence": clean_text(row.get("confidence") or "deterministic"),
            }
        )
    return {"routes": routes, "source": "human_routes"}


def action_search_text(action: Optional[Dict[str, Any]]) -> str:
    if not action:
        return ""
    return " ".join(
        [
            clean_text(action.get("type")),
            clean_text(action.get("caption")),
            clean_text(action.get("businessLabel")),
            clean_text(action.get("shortLabel")),
            clean_text(action.get("audio")),
            clean_text(action.get("nextStep")),
            action_code(action),
        ]
    ).lower()


def is_collect_action(action: Optional[Dict[str, Any]]) -> bool:
    text = action_search_text(action)
    return any(token in text for token in ["cpf", "celular", "celcancel", "cartao", "cartão", "protocolo", "collect", "collecnum", "digita", "pede"])


def is_technical_noise_action(action: Optional[Dict[str, Any]]) -> bool:
    text = action_search_text(action)
    if clean_text((action or {}).get("type")).upper() in {"ONANSWER", "ONRELEASE"}:
        return True
    return any(token in text for token in ["scriptpoint", "mapa_dna", "dados_cdr", "grava_cdr", "marcacdr", "marca_cdr"])


def audio_context_for_action(action: Optional[Dict[str, Any]], semantic_model: Dict[str, Any], transcriptions: Optional[Dict[str, Any]] = None) -> Dict[str, str]:
    if not action:
        return {"fileName": "", "transcription": "", "origin": ""}
    aid = clean_text(action.get("actionId"))
    for prompt in semantic_model.get("prompts", []):
        if clean_text(prompt.get("sourceActionId")) == aid:
            return {
                "fileName": clean_text(prompt.get("fileName") or prompt.get("fullPath")),
                "transcription": clean_text(prompt.get("transcription") or prompt.get("rawTranscription")),
                "origin": f"ActionID {aid}",
            }
    for path in iter_action_audio_paths(action):
        return {"fileName": re.split(r"[\\/]", clean_text(path))[-1], "transcription": "", "origin": f"ActionID {aid}"}
    output = summarize_action_output(action)
    for key in ["audio"]:
        if output.get(key):
            return {"fileName": output[key], "transcription": "", "origin": f"definido em ActionID {aid}"}
    return {"fileName": "", "transcription": "", "origin": ""}


def audio_context_for_file(file_name: Any, semantic_model: Dict[str, Any], origin: str = "") -> Dict[str, str]:
    name = clean_text(file_name)
    if not name:
        return {"fileName": "", "transcription": "", "origin": origin}
    base = re.split(r"[\\/]", name)[-1].strip("\"'")
    base = re.sub(r"^\{[^}]+\}", "", base).strip()
    for prompt in semantic_model.get("prompts", []):
        prompt_name = clean_text(prompt.get("fileName") or prompt.get("fullPath"))
        if prompt_name and re.split(r"[\\/]", prompt_name)[-1].lower() == base.lower():
            return {
                "fileName": clean_text(prompt.get("fileName") or base),
                "transcription": clean_text(prompt.get("transcription") or prompt.get("rawTranscription")),
                "origin": origin or clean_text(prompt.get("sourceActionId")),
            }
    for item in as_list((semantic_model.get("transcriptions") or {}).get("items")):
        item_name = clean_text((item or {}).get("fileName"))
        if item_name and re.split(r"[\\/]", item_name)[-1].lower() == base.lower():
            return {
                "fileName": base,
                "transcription": clean_text((item or {}).get("rawTranscription") or (item or {}).get("text")),
                "origin": origin,
            }
    return {"fileName": base, "transcription": "", "origin": origin}


TRACE_AUDIO_KEYS = {
    "NOTEMENU",
    "NOTEINI",
    "NOTEINC",
    "NOTESIL",
    "NOTEINV",
    "NOTEREJ",
    "NOTEPLAY",
    "AUDIO",
    "AUDIO_MENU1",
    "AUDIO_MENU2",
    "AUDIO_MENU3",
    "MENU_AUDIO1",
    "MENU_AUDIO2",
    "AUDIO_AVISO",
    "AUDIO_AVISO2",
}


def is_audio_context_key(key: Any) -> bool:
    text = clean_text(key).upper()
    return text in TRACE_AUDIO_KEYS or "AUDIO" in text or text.startswith("NOTE")


def extract_audio_file_name(value: Any) -> str:
    text = clean_assignment_value(value)
    if not text or ".wav" not in text.lower():
        return ""
    match = WAV_RE.search(text)
    if match:
        return re.split(r"[\\/]", match.group("path"))[-1].strip("\"'")
    return re.split(r"[\\/]", text)[-1].strip("\"'")


def trace_context_get(trace_context: Dict[str, str], key: Any) -> str:
    text = clean_text(key)
    if not text:
        return ""
    return clean_text(trace_context.get(text) or trace_context.get(text.upper()) or trace_context.get(text.lower()))


def context_snapshot(trace_context: Dict[str, str]) -> Dict[str, str]:
    keys = [
        "NOTEMENU",
        "noteini",
        "noteinc",
        "notesil",
        "noteINV",
        "noteREJ",
        "noteplay",
        "AUDIO",
        "audio",
        "audio_menu1",
        "audio_menu2",
        "audio_menu3",
        "menu_audio1",
        "menu_audio2",
        "audio_aviso",
        "audio_aviso2",
        "MRES",
        "MRES1",
        "MRES2",
        "MRES3",
        "MRESF",
        "SKILL_ID",
        "SKILL_NAME",
        "Transfer_skill",
        "NEXT_STEP",
        "TransferCode",
    ]
    return {key: trace_context_get(trace_context, key) for key in keys if trace_context_get(trace_context, key)}


def audio_variable_candidates(variable: Any, semantic_model: Dict[str, Any], limit: int = 40) -> List[str]:
    wanted = clean_text(variable).strip("{}")
    if not wanted:
        return []
    candidates: List[str] = []

    def add(value: Any, local_assignments: Optional[Dict[str, str]] = None) -> None:
        text = clean_assignment_value(value)
        file_name = extract_audio_file_name(text)
        if not file_name and local_assignments:
            ref = text.strip("{}")
            if ref and ref != text:
                file_name = extract_audio_file_name(local_assignments.get(ref) or local_assignments.get(ref.upper()) or local_assignments.get(ref.lower()))
        if file_name and not is_auxiliary_audio_file(file_name) and file_name not in candidates:
            candidates.append(file_name)

    for action in semantic_model.get("actions", []):
        code = action_code(action)
        assignments = parse_assignments(code)
        for key, value in assignments.items():
            if clean_text(key).lower() == wanted.lower():
                add(value, assignments)
        for case in parse_switch_case_tree(code):
            case_assignments = case.get("assignments") or {}
            for key, value in case_assignments.items():
                if clean_text(key).lower() == wanted.lower():
                    add(value, case_assignments)
        if len(candidates) >= limit:
            break
    return candidates[:limit]


def filter_audio_candidates_for_context(candidates: List[str], trace_context: Dict[str, str], action: Optional[Dict[str, Any]] = None) -> List[str]:
    context_text = " ".join([*(clean_text(value) for value in (trace_context or {}).values()), clean_text((action or {}).get("caption")), action_code(action or {})])
    company = company_from_text(context_text)
    if not company:
        return candidates
    filtered = [item for item in candidates if company_from_text(item) == company or company.lower() in clean_text(item).lower()]
    return filtered or candidates


def resolve_audio_with_trace_context(value: Any, trace_context: Dict[str, str], semantic_model: Dict[str, Any], origin: str = "") -> Dict[str, Any]:
    text = clean_assignment_value(value)
    if not text:
        return {"fileName": "", "transcription": "", "origin": origin}
    chain: List[str] = []
    current = text
    visited = set()
    for _ in range(10):
        file_name = extract_audio_file_name(current)
        if file_name:
            audio = audio_context_for_file(file_name, semantic_model, origin)
            audio["resolvedFrom"] = " -> ".join(chain + [clean_text(value)]) if chain else clean_text(value)
            return audio
        variable = clean_text(current).strip("{}")
        if not variable or variable in visited:
            break
        visited.add(variable)
        chain.append(variable)
        candidate = trace_context_get(trace_context, variable)
        if not candidate:
            if is_audio_context_key(variable):
                candidates = filter_audio_candidates_for_context(audio_variable_candidates(variable, semantic_model), trace_context)
                return {
                    "mode": "dynamic",
                    "variable": variable,
                    "fileName": "",
                    "transcription": "",
                    "origin": origin,
                    "resolvedFrom": " -> ".join(chain),
                    "candidates": candidates,
                    "description": "Audio varia conforme a opcao escolhida nesta trilha.",
                }
            break
        current = candidate
    return {"fileName": "", "transcription": "", "origin": origin}


def action_audio_references(action: Optional[Dict[str, Any]]) -> List[str]:
    if not action:
        return []
    refs: List[str] = []
    code = action_code(action)
    for token in re.findall(r"\{([^}]+)\}", code):
        if is_audio_context_key(token) and token not in refs:
            refs.append("{" + token + "}")
    output = summarize_action_output(action)
    for value in [output.get("audio")]:
        if clean_text(value) and clean_text(value) not in refs:
            refs.append(clean_text(value))
    for path in iter_action_audio_paths(action):
        if path not in refs:
            refs.append(path)
    return refs


def dynamic_menu_audio_for_action(action: Optional[Dict[str, Any]], semantic_model: Dict[str, Any], origin: str = "", trace_context: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    if not action or clean_text(action.get("type")).upper() != "MENU":
        return {"fileName": "", "transcription": "", "origin": origin}
    capture_var = clean_text(menu_variable(action.get("parameters"))).upper()
    if capture_var not in {"MRES1", "MRES2", "MRES3", "MRESF"}:
        return {"fileName": "", "transcription": "", "origin": origin}
    for reference in action_audio_references(action):
        variable = clean_text(reference).strip("{}")
        if variable.upper() in {"AUDIO_MENU1", "AUDIO_MENU2", "AUDIO_MENU3", "MENU_AUDIO1", "MENU_AUDIO2"}:
            candidates = filter_audio_candidates_for_context(audio_variable_candidates(variable, semantic_model), trace_context or {}, action)
            return {
                "mode": "dynamic",
                "variable": variable,
                "fileName": "",
                "transcription": "",
                "origin": origin or f"ActionID {action.get('actionId')}",
                "resolvedFrom": variable,
                "candidates": candidates,
                "description": "Audio varia conforme a opcao escolhida neste menu.",
            }
    return {"fileName": "", "transcription": "", "origin": origin}


def render_audio_line(audio: Any) -> str:
    if not isinstance(audio, dict):
        audio = {"fileName": clean_text(audio), "transcription": ""}
    if clean_text(audio.get("mode")) == "dynamic":
        lines = [short_label(f"Audio: {audio.get('variable')}", 74)]
        if clean_text(audio.get("description")):
            lines.append(short_label(audio.get("description"), 86))
        candidates = [clean_text(item) for item in audio.get("candidates") or [] if clean_text(item)]
        if candidates:
            lines.append("Possiveis:")
            lines.extend(short_label(item, 74) for item in candidates[:4])
        return "\n".join(line for line in lines if clean_text(line))
    spoken = clean_text(audio.get("transcription") or audio.get("text"))
    if spoken:
        return short_label(f'"{spoken}"', 96)
    return short_label(clean_text(audio.get("fileName")), 74)


def resolve_audio_for_step(step: Dict[str, Any], trace_context: Dict[str, str], semantic_model: Dict[str, Any]) -> Dict[str, str]:
    action = action_by_id(semantic_model).get(clean_text(step.get("actionId")))
    dynamic_menu_audio = dynamic_menu_audio_for_action(action, semantic_model, clean_text(step.get("actionId")), trace_context)
    if clean_text(dynamic_menu_audio.get("mode")) == "dynamic":
        return dynamic_menu_audio

    existing = step.get("audio") if isinstance(step.get("audio"), dict) else {}
    if clean_text(existing.get("mode")) == "dynamic":
        return existing
    if clean_text(existing.get("fileName")) and clean_text(existing.get("transcription")):
        return existing
    if clean_text(existing.get("fileName")) and not is_auxiliary_audio_file(existing.get("fileName")):
        return audio_context_for_file(existing.get("fileName"), semantic_model, clean_text(existing.get("origin")))

    step_type = clean_text(step.get("type") or (action or {}).get("type")).upper()
    if step_type not in {"MENU", "PLAY", "SNIPPET", "SNIPPET_CASE"}:
        return {"fileName": "", "transcription": "", "origin": ""}

    for reference in action_audio_references(action):
        audio = resolve_audio_with_trace_context(reference, trace_context, semantic_model, clean_text(step.get("actionId")) or clean_text(reference))
        if clean_text(audio.get("fileName")) or clean_text(audio.get("mode")) == "dynamic":
            return audio

    keys = ["NOTEMENU", "noteplay", "AUDIO", "audio", "audio_menu1", "audio_menu2", "audio_menu3", "menu_audio1", "menu_audio2", "noteini", "noteinc", "notesil", "noteINV", "noteREJ", "audio_aviso", "audio_aviso2"]
    for key in keys:
        value = clean_text(trace_context.get(key) or trace_context.get(key.upper()) or trace_context.get(key.lower()))
        if value:
            audio = resolve_audio_with_trace_context(value, trace_context, semantic_model, key)
            if clean_text(audio.get("fileName")) or clean_text(audio.get("mode")) == "dynamic":
                return audio

    if action:
        direct = audio_context_for_action(action, semantic_model)
        if clean_text(direct.get("fileName")) and not is_auxiliary_audio_file(direct.get("fileName")):
            return direct
    return {"fileName": "", "transcription": "", "origin": ""}


def resolve_audio_for_visual_block(block: Dict[str, Any], trace_context: Dict[str, str], semantic_model: Dict[str, Any], transcriptions: Optional[Dict[str, Any]] = None) -> Dict[str, str]:
    action_ids = [clean_text(item) for item in block.get("technicalActionIds") or [] if clean_text(item)]
    action_id = clean_text(block.get("actionId")) or (action_ids[0] if action_ids else "")
    action = action_by_id(semantic_model).get(action_id)
    dynamic_menu_audio = dynamic_menu_audio_for_action(action, semantic_model, action_id, trace_context)
    if clean_text(dynamic_menu_audio.get("mode")) == "dynamic":
        return dynamic_menu_audio

    existing = block.get("audio") if isinstance(block.get("audio"), dict) else {}
    if clean_text(existing.get("mode")) == "dynamic":
        return existing
    if clean_text(existing.get("fileName")) and clean_text(existing.get("transcription")):
        return existing
    if clean_text(existing.get("fileName")) and not is_auxiliary_audio_file(existing.get("fileName")):
        return audio_context_for_file(existing.get("fileName"), semantic_model, clean_text(existing.get("origin")))

    block_type = clean_text(block.get("type")).lower()

    for reference in action_audio_references(action):
        audio = resolve_audio_with_trace_context(reference, trace_context, semantic_model, action_id or clean_text(reference))
        if clean_text(audio.get("fileName")) or clean_text(audio.get("mode")) == "dynamic":
            return audio

    context_keys_by_type = {
        "menu": ["NOTEMENU", "AUDIO", "audio", "menu_audio1", "menu_audio2", "audio_menu1", "audio_menu2", "audio_menu3"],
        "play": ["noteplay", "NOTEMENU", "AUDIO", "audio", "noteini", "noteinc", "audio_aviso", "audio_aviso2"],
        "process": ["AUDIO", "audio", "noteini", "noteinc", "audio_aviso", "audio_aviso2"],
        "loop": ["notesil", "noteINV", "noteREJ", "AUDIO"],
    }
    for key in context_keys_by_type.get(block_type, []):
        value = clean_text(trace_context.get(key) or trace_context.get(key.upper()) or trace_context.get(key.lower()))
        if value:
            audio = resolve_audio_with_trace_context(value, trace_context, semantic_model, key)
            if clean_text(audio.get("fileName")) or clean_text(audio.get("mode")) == "dynamic":
                return audio

    if action and block_type in {"menu", "play", "process"}:
        direct = audio_context_for_action(action, semantic_model, transcriptions)
        if clean_text(direct.get("fileName")) and not is_auxiliary_audio_file(direct.get("fileName")):
            return direct
    return {"fileName": "", "transcription": "", "origin": ""}


def clean_option_label_token(value: Any) -> str:
    text = clean_text(value)
    if not text:
        return ""
    text = re.sub(r"\.wav$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", text)
    text = re.sub(r"(?i)\b(action|actionid|case|menu|snippet|play|if|runscript|runsub|rest_api|reqagent)\b", " ", text)
    text = re.sub(r"(?i)\b(ura|prod|dev|hml|homolog|ini|inicio|inicial|final|fluxo|script|ctl|ctrl|config|next|step|path|direciona|opcao|opção|escolhida|atualiza|variaveis|variáveis|transfer|maxrej|maxsil|maxinv|maxinc)\b", " ", text)
    text = re.sub(r"[_./\\:;|\[\](){}-]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return ""
    words = text.split()
    if len(words) > 4:
        words = words[-4:]
    return normalize_human_text(" ".join(words))


def remove_common_label_prefix(options: List[Dict[str, Any]]) -> None:
    labels = [clean_text(option.get("label")) for option in options if clean_text(option.get("label")) and not clean_text(option.get("label")).lower().startswith("opcao ")]
    if len(labels) < 2:
        return
    split_labels = [label.split() for label in labels]
    common: List[str] = []
    for words in zip(*split_labels):
        if len({word.lower() for word in words}) == 1:
            common.append(words[0])
        else:
            break
    if not common:
        return
    common_len = len(common)
    for option in options:
        label = clean_text(option.get("label"))
        words = label.split()
        if len(words) > common_len and [w.lower() for w in words[:common_len]] == [w.lower() for w in common]:
            option["label"] = " ".join(words[common_len:])


def is_bad_option_label(value: Any) -> bool:
    text = clean_text(value).lower()
    if not text:
        return True
    return bool(
        re.search(
            r"\b(maxrej|maxsil|maxinv|maxinc|atualiza|variaveis|variáveis|direciona|opcao escolhida|pathstep|next step|transfer|executa proximo destino|executa proximo passo)$",
            text,
            re.IGNORECASE,
        )
    )


def extract_menu_option_labels_from_transcription(text: Any) -> Dict[str, str]:
    spoken = clean_text(text)
    labels: Dict[str, str] = {}
    if not spoken:
        return labels
    patterns = [
        r"(?:para|opcao|opção)\s+(.{2,80}?)\s*(?:,|\.|;)?\s*(?:digite|tecle|pressione)\s+([0-9*#]+)",
        r"(?:digite|tecle|pressione)\s+([0-9*#]+)\s+(?:para|opcao|opção)\s+(.{2,80}?)(?:\.|,|;|$)",
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, spoken, re.IGNORECASE):
            if match.lastindex != 2:
                continue
            if match.group(1).strip().isdigit() or match.group(1).strip() in {"*", "#"}:
                digit, label = match.group(1), match.group(2)
            else:
                label, digit = match.group(1), match.group(2)
            label = re.sub(r"\b(?:e|ou|entao|então|por favor)$", "", clean_text(label), flags=re.IGNORECASE).strip(" ,.;")
            label = clean_option_label_token(label)
            if digit and label and digit not in labels:
                labels[digit] = label
    return labels


def infer_label_from_target_subflow(target_action_id: Any, semantic_model: Dict[str, Any]) -> str:
    start_id = clean_text(target_action_id)
    if not start_id:
        return ""
    actions_map, adjacency, _incoming = build_navigation_maps(semantic_model)
    if start_id not in actions_map:
        return clean_option_label_token(start_id)
    queue = [start_id]
    visited = set()
    candidates: List[Tuple[int, str]] = []
    while queue and len(visited) < 40:
        aid = queue.pop(0)
        if aid in visited:
            continue
        visited.add(aid)
        action = actions_map.get(aid)
        if not action:
            continue
        output = summarize_action_output(action)
        for score, value in [
            (100, output.get("skillName")),
            (95, output.get("nextStep")),
            (90, output.get("transferCode")),
            (80, clean_text(action.get("businessLabel"))),
            (70, clean_text(action.get("caption"))),
            (65, output.get("audio")),
        ]:
            label = clean_option_label_token(subject_from_skill_name(value) if score >= 90 else audio_subject_from_path(value) if score == 65 else value)
            if label and not is_generic_technical_label(label):
                candidates.append((score, label))
        for path in iter_action_audio_paths(action):
            label = clean_option_label_token(audio_subject_from_path(path))
            if label:
                candidates.append((60, label))
        for edge in adjacency.get(aid, []):
            target = clean_text(edge.get("target"))
            if target and target not in visited:
                queue.append(target)
    if not candidates:
        return ""
    return sorted(candidates, key=lambda item: (-item[0], len(item[1])))[0][1]




def is_root_menu(menu_action: Optional[Dict[str, Any]], navigation_story: Optional[Dict[str, Any]], semantic_model: Dict[str, Any]) -> bool:
    if not menu_action:
        return False
    aid = clean_text(menu_action.get("actionId"))
    if isinstance(navigation_story, dict) and clean_text((navigation_story.get("mainMenu") or {}).get("actionId")) == aid:
        return True
    text = " ".join([clean_text(menu_action.get("caption")), action_code(menu_action)]).lower()
    if any(token in text for token in ["menuinicial", "menu inicial", "menu principal", "sauda", "saudação", "saudacao", "menuprincipal"]):
        return True
    audio = audio_context_for_action(menu_action, semantic_model)
    if "menuprincipal" in clean_text(audio.get("fileName")).lower():
        return True
    main_menu = find_main_menu_for_story(semantic_model, {})
    return aid and aid == clean_text((main_menu or {}).get("actionId"))


ROOT_LABEL_STOPWORDS = {
    "ura",
    "ivr",
    "prod",
    "dev",
    "hml",
    "homolog",
    "homologacao",
    "menu",
    "inicial",
    "principal",
    "saudacao",
    "audio",
    "prompt",
    "prompts",
    "wav",
}


def identifier_words(value: Any) -> List[str]:
    text = clean_text(value)
    if not text:
        return []
    text = re.split(r"[\\/]", text)[-1]
    text = re.sub(r"\.[A-Za-z0-9]+$", "", text)
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
    return [clean_text(item).lower() for item in re.split(r"[^A-Za-z0-9À-ÿ]+", text) if clean_text(item)]


def identifier_original_words(value: Any) -> List[str]:
    text = clean_text(value)
    if not text:
        return []
    text = re.split(r"[\\/]", text)[-1]
    text = re.sub(r"\.[A-Za-z0-9]+$", "", text)
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
    return [clean_text(item) for item in re.split(r"[^A-Za-z0-9À-ÿ]+", text) if clean_text(item)]


def project_identifier_words(semantic_model: Dict[str, Any]) -> set:
    project = semantic_model.get("project") or {}
    tokens = set(identifier_words(project.get("name")) + identifier_words(project.get("source")))
    return {token for token in tokens if token and len(token) > 1}


def clean_root_candidate_label(value: Any, semantic_model: Dict[str, Any]) -> str:
    words = identifier_words(value)
    if not words:
        return ""
    original_by_lower = {word.lower(): word for word in identifier_original_words(value)}
    filtered = [word for word in words if word not in ROOT_LABEL_STOPWORDS]
    project_tokens = project_identifier_words(semantic_model)
    without_project = [word for word in filtered if word not in project_tokens]
    if without_project:
        filtered = without_project
    if not filtered:
        filtered = words
    selected = filtered[-3:]
    label_words = []
    for word in selected:
        original = original_by_lower.get(word, word)
        label_words.append(original.upper() if original.isupper() and 1 < len(original) <= 6 else normalize_human_text(word))
    label = label_words[0] if len(label_words) == 1 and label_words[0].isupper() else clean_option_label_token(" ".join(label_words))
    if is_generic_technical_label(label) or is_bad_option_label(label):
        return ""
    return label


def root_branch_functional_label(action: Dict[str, Any], semantic_model: Dict[str, Any]) -> str:
    output = summarize_action_output(action)
    for value in [output.get("nextStep"), clean_text(action.get("caption")), *iter_action_audio_paths(action), output.get("audio")]:
        label = clean_root_candidate_label(value, semantic_model)
        if label:
            return label
    return ""


def is_root_branch_noise(action: Dict[str, Any]) -> bool:
    atype = clean_text(action.get("type")).upper()
    text = " ".join([clean_text(action.get("caption")), action_code(action)]).lower()
    if atype in {"BEGIN", "SNIPPET", "PLAY", "LOCATE", "CASE", "HOURS", "IF", "RUNSUB", "REST_API", "LOOP", "END"}:
        return True
    if atype == "MENU" and is_collect_action(action):
        return True
    return any(token in text for token in ["scriptpoint", "config_menu", "checkcpf", "checkmobile", "collecnum", "collectnum"])


def infer_root_menu_option_label(option: Dict[str, Any], menu_action: Optional[Dict[str, Any]], semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any]) -> str:
    start_id = clean_text(option.get("targetActionId"))
    if not start_id:
        return ""
    actions_map, adjacency, _incoming = build_navigation_maps(semantic_model)
    queue = [start_id]
    visited = set()
    while queue and len(visited) < 45:
        aid = queue.pop(0)
        if aid in visited:
            continue
        visited.add(aid)
        action = actions_map.get(aid)
        if not action:
            continue
        branch_label = root_branch_functional_label(action, semantic_model)
        if branch_label and not is_root_branch_noise(action):
            return branch_label
        atype = clean_text(action.get("type")).upper()
        if atype == "MENU" and not is_root_branch_noise(action):
            menu_label = root_branch_functional_label(action, semantic_model)
            if menu_label:
                return menu_label
        edges = adjacency.get(aid, [])
        if atype == "HOURS":
            preferred = next((edge for edge in edges if edge_label_text(edge).lower() in {"open", "aberto"}), None)
            if preferred:
                queue.insert(0, clean_text(preferred.get("target")))
                continue
        for edge in edges:
            target = clean_text(edge.get("target"))
            if target and target not in visited:
                queue.append(target)
    return ""


def infer_main_menu_option_label(option: Dict[str, Any], main_menu: Optional[Dict[str, Any]], semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any], transcriptions: Optional[Dict[str, Any]] = None) -> str:
    digit = clean_text(option.get("digit"))
    if is_root_menu(main_menu, None, semantic_model):
        root_label = infer_root_menu_option_label(option, main_menu, semantic_model, ai_organizer)
        if root_label:
            return root_label
    menu_audio = audio_context_for_action(main_menu, semantic_model) if main_menu else {"fileName": "", "transcription": ""}
    labels_from_speech = extract_menu_option_labels_from_transcription(menu_audio.get("transcription"))
    if digit in labels_from_speech:
        return labels_from_speech[digit]
    ai_label = ai_menu_option_label(ai_organizer, clean_text((main_menu or {}).get("actionId")), digit)
    if clean_text(ai_label.get("label")) and not clean_text(ai_label.get("label")).lower().startswith("opcao "):
        return clean_option_label_token(ai_label.get("label"))
    for value in [option.get("nextStep"), option.get("transferCode"), option.get("skillName")]:
        label = clean_option_label_token(subject_from_skill_name(value) or value)
        if label and not is_generic_technical_label(label) and label.lower() not in {"pathstep transfer", "path transfer", "transfer"}:
            return label
    for value in [option.get("audio")]:
        label = clean_option_label_token(audio_subject_from_path(value) or value)
        if label and not is_generic_technical_label(label) and label.lower() not in {"pathstep transfer", "path transfer", "transfer"}:
            return label
    target_label = infer_label_from_target_subflow(option.get("targetActionId"), semantic_model)
    if target_label and target_label.lower() not in {"pathstep transfer", "path transfer", "transfer"}:
        return target_label
    return f"Opcao {digit}"


def find_main_menu_for_story(semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    actions_map = action_by_id(semantic_model)
    candidate_id = clean_text((ai_organizer.get("mainMenuCandidate") or {}).get("actionId")) if isinstance(ai_organizer.get("mainMenuCandidate"), dict) else ""
    if candidate_id in actions_map and clean_text(actions_map[candidate_id].get("type")).upper() == "MENU" and not is_collect_action(actions_map[candidate_id]):
        return actions_map[candidate_id]

    order, levels = navigation_order(semantic_model)
    menus = [actions_map[aid] for aid in order if aid in actions_map and clean_text(actions_map[aid].get("type")).upper() == "MENU" and not is_collect_action(actions_map[aid])]
    if not menus:
        menus = [action for action in semantic_model.get("actions", []) if isinstance(action, dict) and clean_text(action.get("type")).upper() == "MENU"]
    if not menus:
        return None

    def score(menu: Dict[str, Any]) -> int:
        text = action_search_text(menu)
        value = 100 - levels.get(clean_text(menu.get("actionId")), 50)
        if menu.get("cases"):
            value += 40
        if menu_variable(menu.get("parameters")).lower() in {"mres", "mres1", "mres2", "mresf", "op_escolhida", "opcao"}:
            value += 25
        if any(token in text for token in ["principal", "inicial", "menuinicial", "sauda", "menu"]):
            value += 20
        if is_collect_action(menu):
            value -= 100
        return value

    return sorted(menus, key=score, reverse=True)[0]


def reachable_action_ids(start_id: str, semantic_model: Dict[str, Any], limit: int = 80) -> List[str]:
    actions_map, adjacency, _incoming = build_navigation_maps(semantic_model)
    if start_id not in actions_map:
        return []
    result: List[str] = []
    queue = [start_id]
    visited = set()
    while queue and len(result) < limit:
        aid = queue.pop(0)
        if aid in visited or aid not in actions_map:
            continue
        visited.add(aid)
        result.append(aid)
        for edge in adjacency.get(aid, []):
            target = clean_text(edge.get("target"))
            if target and target not in visited:
                queue.append(target)
    return result


def action_story_label(action: Dict[str, Any], ai_organizer: Dict[str, Any]) -> str:
    aid = clean_text(action.get("actionId"))
    friendly = friendly_action_label(action, ai_organizer)
    if friendly and not is_generic_technical_label(friendly):
        return friendly
    for item in ai_organizer.get("preMenuLabels", []) or []:
        if isinstance(item, dict) and clean_text(item.get("actionId")) == aid:
            value = clean_text(item.get("humanLabel") or item.get("humanQuestion"))
            if value and not is_generic_technical_label(value):
                return value
    for item in ai_organizer.get("actionAnnotations", []) or ai_organizer.get("actionLabels", []) or []:
        if isinstance(item, dict) and clean_text(item.get("actionId")) == aid:
            value = clean_text(item.get("shortLabel") or item.get("businessLabel"))
            if value and not is_generic_technical_label(value):
                return value
    atype = clean_text(action.get("type")).upper()
    if atype == "BEGIN":
        return "Inicio da URA"
    if atype == "HOURS":
        return "Validacao de horario"
    if atype == "IF":
        return humanize_if_condition(action, ai_organizer)
    if atype == "PLAY":
        return "Mensagem de audio"
    if atype in {"RUNSUB", "REST_API"}:
        return "Consulta API / integracao"
    if atype == "RUNSCRIPT":
        output = summarize_action_output(action)
        return "Direciona para " + short_label(output.get("nextStep") or action.get("caption") or "proximo script", 40)
    if is_technical_noise_action(action):
        return "Preparacao tecnica / CDR"
    return short_label(clean_text(action.get("businessLabel") or action.get("caption") or atype), 70)


def build_pre_menu_story(semantic_model: Dict[str, Any], pre_semantic_extract: Dict[str, Any], ai_organizer: Dict[str, Any], main_menu: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    actions_map, adjacency, _incoming = build_navigation_maps(semantic_model)
    main_id = clean_text((main_menu or {}).get("actionId"))
    order, _levels = navigation_order(semantic_model)
    story: List[Dict[str, Any]] = []
    for aid in order:
        if aid == main_id:
            break
        action = actions_map.get(aid)
        if not action:
            continue
        atype = clean_text(action.get("type")).upper()
        if atype not in {"BEGIN", "IF", "HOURS", "PLAY", "SNIPPET", "RUNSUB", "REST_API", "RUNSCRIPT"} and not is_technical_noise_action(action):
            continue
        if atype == "SNIPPET" and not is_technical_noise_action(action) and not summarize_action_output(action).get("audio"):
            continue
        audio = audio_context_for_action(action, semantic_model)
        story.append(
            {
                "actionId": aid,
                "type": atype,
                "label": action_story_label(action, ai_organizer),
                "shape": "decision" if atype == "IF" else "process" if atype != "BEGIN" else "terminal_start",
                "audio": audio,
                "evidence": [f"ActionID {aid}"],
            }
        )
        if len(story) >= 8:
            break
    if not story:
        story.append({"actionId": "", "type": "BEGIN", "label": "Inicio da URA", "shape": "terminal_start", "audio": {}, "evidence": []})
    return story


def menu_options_for_story(menu: Optional[Dict[str, Any]], ai_organizer: Dict[str, Any]) -> List[Dict[str, str]]:
    if not menu:
        return []
    menu_id = clean_text(menu.get("actionId"))
    ai_menu = {}
    for item in ai_organizer.get("menuLabels", []) or []:
        if isinstance(item, dict) and clean_text(item.get("menuActionId")) == menu_id:
            ai_menu = item
            break
    labels = {clean_text(opt.get("digit")): opt for opt in ai_menu.get("options", []) or [] if isinstance(opt, dict)}
    options = []
    for index, case in enumerate(menu.get("cases") or [], start=1):
        digit = clean_text(case.get("value") or case.get("name") or index)
        ai_opt = labels.get(digit, {})
        options.append(
            {
                "digit": digit,
                "label": clean_text(ai_opt.get("label") or f"Opcao {digit}"),
                "description": clean_text(ai_opt.get("description")),
                "targetActionId": clean_text(ai_opt.get("targetActionId") or case.get("target")),
                "evidence": f"CASE {digit} / ActionID {menu_id}",
            }
        )
    return options[:8]


def refine_main_menu_options(options: List[Dict[str, Any]], main_menu: Optional[Dict[str, Any]], semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any]) -> List[Dict[str, Any]]:
    refined: List[Dict[str, Any]] = []
    for option in options:
        item = dict(option)
        label = infer_main_menu_option_label(item, main_menu, semantic_model, ai_organizer)
        if label and not is_bad_option_label(label):
            item["label"] = short_label(label, 70)
        elif not clean_text(item.get("label")):
            item["label"] = f"Opcao {clean_text(item.get('digit'))}"
        if is_bad_option_label(item.get("label")):
            item["label"] = f"Opcao {clean_text(item.get('digit'))}"
        refined.append(item)
    remove_common_label_prefix(refined)
    return refined


def edge_label_text(edge: Dict[str, Any]) -> str:
    return clean_text(edge.get("label") or edge.get("name") or edge.get("value") or edge.get("kind"))


def default_next_id(action: Optional[Dict[str, Any]], adjacency: Dict[str, List[Dict[str, Any]]]) -> str:
    if not action:
        return ""
    direct = clean_text(action.get("defaultNextAction"))
    if direct:
        return direct
    aid = clean_text(action.get("actionId"))
    edges = adjacency.get(aid, [])
    if not edges:
        return ""
    preferred = sorted(edges, key=lambda edge: 0 if edge_label_text(edge).lower() in {"", "default"} else 1)[0]
    return clean_text(preferred.get("target"))


def is_terminal_or_treatment_target(action: Optional[Dict[str, Any]]) -> bool:
    if not action:
        return False
    atype = clean_text(action.get("type")).upper()
    text = action_search_text(action)
    if atype in {"END", "LOOP", "ONRELEASE"}:
        return True
    if atype in {"PLAY", "RUNSCRIPT"}:
        return any(token in text for token in ["desliga", "tchau", "encerra", "timeout", "maxsil", "maxinv", "maxrej", "erro", "reject"])
    return False


def target_leads_to_terminal_treatment(target_id: str, actions_map: Dict[str, Dict[str, Any]], adjacency: Dict[str, List[Dict[str, Any]]], max_depth: int = 6) -> bool:
    current_id = clean_text(target_id)
    visited = set()
    depth = 0
    while current_id and current_id not in visited and depth < max_depth:
        visited.add(current_id)
        action = actions_map.get(current_id)
        if not action:
            return False
        atype = clean_text(action.get("type")).upper()
        if is_terminal_or_treatment_target(action):
            return True
        if atype in {"MENU", "HOURS", "IF", "LOCATE", "CASE", "RUNSUB", "REST_API", "REQAGENT"}:
            return False
        next_id = default_next_id(action, adjacency)
        if not next_id:
            return False
        current_id = next_id
        depth += 1
    return False


def edge_navigation_score(edge: Dict[str, Any], actions_map: Dict[str, Dict[str, Any]], adjacency: Dict[str, List[Dict[str, Any]]]) -> int:
    target_id = clean_text(edge.get("target"))
    target = actions_map.get(target_id)
    if not target:
        return 1
    atype = clean_text(target.get("type")).upper()
    if is_terminal_or_treatment_target(target) or target_leads_to_terminal_treatment(target_id, actions_map, adjacency):
        return -20
    if atype in {"MENU", "HOURS", "IF", "LOCATE", "CASE", "SNIPPET", "PLAY", "RUNSUB", "REST_API", "RUNSCRIPT", "REQAGENT"}:
        return 10
    return 2


def choose_functional_main_edge(action: Dict[str, Any], outgoing_edges: List[Dict[str, Any]], semantic_model: Dict[str, Any], trace_context: Optional[Dict[str, str]] = None, option_digit: str = "") -> Optional[Dict[str, Any]]:
    if not outgoing_edges:
        return None
    if is_hours_action(action):
        return choose_main_navigation_edge(action, outgoing_edges, trace_context or {}, option_digit)
    actions_map = action_by_id(semantic_model)
    _actions_map, adjacency, _incoming = build_navigation_maps(semantic_model)
    atype = clean_text(action.get("type")).upper()
    if atype == "IF":
        navigable = [edge for edge in outgoing_edges if edge_navigation_score(edge, actions_map, adjacency) > 0]
        if navigable:
            preferred = next((edge for edge in navigable if edge_label_text(edge).lower() in {"false", "nao", "não", "no"}), None)
            return preferred or sorted(navigable, key=lambda edge: -edge_navigation_score(edge, actions_map, adjacency))[0]
        return None
    return choose_main_navigation_edge(action, outgoing_edges, trace_context or {}, option_digit)


def build_decision_side_branches(action: Dict[str, Any], outgoing_edges: List[Dict[str, Any]], main_edge: Optional[Dict[str, Any]], semantic_model: Dict[str, Any]) -> List[Dict[str, Any]]:
    actions_map, adjacency, _incoming = build_navigation_maps(semantic_model)
    main_target = clean_text((main_edge or {}).get("target"))
    branches = []
    for edge in outgoing_edges:
        target_id = clean_text(edge.get("target"))
        if not target_id or target_id == main_target:
            continue
        target = actions_map.get(target_id)
        branches.append(
            {
                "label": human_branch_label(edge_label_text(edge)),
                "targetActionId": target_id,
                "meaning": branch_meaning(edge_label_text(edge), semantic_model, target_id),
                "terminal": is_terminal_or_treatment_target(target) or target_leads_to_terminal_treatment(target_id, actions_map, adjacency),
            }
        )
    return branches[:4]


def trace_pre_menu_path(semantic_model: Dict[str, Any], main_menu_action_id: str, ai_organizer: Dict[str, Any]) -> List[Dict[str, Any]]:
    actions_map, adjacency, _incoming = build_navigation_maps(semantic_model)
    begin = next((action for action in semantic_model.get("actions", []) if clean_text(action.get("type")).upper() == "BEGIN"), None)
    current_id = clean_text((begin or {}).get("actionId"))
    story: List[Dict[str, Any]] = []
    visited = set()
    while current_id and current_id not in visited and len(story) < 12:
        visited.add(current_id)
        if current_id == main_menu_action_id:
            break
        action = actions_map.get(current_id)
        if not action:
            break
        atype = clean_text(action.get("type")).upper()
        if atype in {"BEGIN", "IF", "HOURS", "PLAY", "SNIPPET", "RUNSUB", "REST_API", "RUNSCRIPT", "END"} or is_technical_noise_action(action):
            outgoing = adjacency.get(current_id, [])
            main_edge = choose_functional_main_edge(action, outgoing, semantic_model, {}, "")
            item = {
                "actionId": current_id,
                "type": atype,
                "label": action_story_label(action, ai_organizer),
                "displayLabel": hours_display_label(action) if atype == "HOURS" else friendly_action_label(action, ai_organizer),
                "technicalLabel": f"{atype} ActionID {current_id}",
                "conditionLabel": humanize_if_for_display(action, ai_organizer)[1] if atype == "IF" else "",
                "businessDescription": clean_text(ai_display_label_for_action(current_id, ai_organizer).get("businessDescription")),
                "shape": "decision" if atype in {"IF", "HOURS"} else "terminal_end" if atype == "END" else "terminal_start" if atype == "BEGIN" else "process",
                "audio": audio_context_for_action(action, semantic_model),
                "branches": build_decision_side_branches(action, outgoing, main_edge, semantic_model) if atype == "IF" else [
                    {
                        "label": human_branch_label(edge_label_text(edge)),
                        "targetActionId": clean_text(edge.get("target")),
                        "meaning": branch_meaning(edge_label_text(edge), semantic_model, clean_text(edge.get("target"))),
                    }
                    for edge in outgoing
                    if edge_label_text(edge).lower() not in {"", "default"}
                ][:4],
                "evidence": [f"ActionID {current_id}"],
            }
            if atype == "HOURS":
                item.update(extract_hours_treatments_for_step(action, semantic_model, {}, ai_organizer))
                item["branches"] = []
            story.append(item)
            if atype == "END":
                break
        if atype == "HOURS":
            main_edge = choose_main_navigation_edge(action, adjacency.get(current_id, []), {}, "")
            current_id = clean_text((main_edge or {}).get("target"))
        elif atype == "IF":
            main_edge = choose_functional_main_edge(action, adjacency.get(current_id, []), semantic_model, {}, "")
            if not main_edge:
                if story:
                    story[-1]["stopBeforeMenu"] = True
                break
            current_id = clean_text((main_edge or {}).get("target"))
            if not current_id:
                break
        else:
            current_id = default_next_id(action, adjacency)
    if not story:
        story.append({"actionId": "", "type": "BEGIN", "label": "Inicio da URA", "shape": "terminal_start", "audio": {}, "branches": [], "evidence": []})
    return story


def parse_mask_options_from_text(text: str) -> List[str]:
    options: List[str] = []
    for match in re.finditer(r"\b(?:MASCARA|MASK)\s*=\s*['\"]([^'\"]+)['\"]", text, re.IGNORECASE):
        for part in re.split(r"[-,;|/\s]+", clean_text(match.group(1))):
            value = clean_text(part)
            if value and value not in {"-", "_"} and value not in options:
                options.append(value)
    return options


def find_menu_dispatcher(menu_action_id: str, semantic_model: Dict[str, Any]) -> Dict[str, Any]:
    actions_map, adjacency, _incoming = build_navigation_maps(semantic_model)
    current_id = clean_text(menu_action_id)
    visited = set()
    path: List[str] = []
    dispatcher = ""
    while current_id and current_id not in visited and len(path) < 12:
        visited.add(current_id)
        path.append(current_id)
        action = actions_map.get(current_id)
        if not action:
            break
        if current_id != menu_action_id:
            code = action_code(action)
            text = f"{clean_text(action.get('type'))} {clean_text(action.get('caption'))} {code}".lower()
            switch_items = parse_switch_case_tree(code)
            has_dispatch_assignments = any((item.get("caseValues") or item.get("assignments", {}).get("NEXT_STEP") or item.get("assignments", {}).get("next_step")) for item in switch_items)
            if has_dispatch_assignments or any(token in text for token in ["switch", "next_step"]):
                dispatcher = current_id
                break
        outgoing = adjacency.get(current_id, [])
        found_edge = next((edge for edge in outgoing if edge_label_text(edge).lower() == "found"), None)
        current_id = clean_text(found_edge.get("target")) if found_edge else default_next_id(action, adjacency)
    dispatcher_action = actions_map.get(dispatcher) if dispatcher else None
    return {
        "actionId": dispatcher,
        "path": path,
        "action": dispatcher_action,
        "switchCases": parse_switch_case_tree(action_code(dispatcher_action or {})) if dispatcher_action else [],
        "maskOptions": parse_mask_options_from_text(action_code(dispatcher_action or {})) if dispatcher_action else [],
    }


def ai_menu_option_label(ai_organizer: Dict[str, Any], menu_action_id: str, digit: str) -> Dict[str, str]:
    for item in ai_organizer.get("menuOptionLabels", []) or []:
        if isinstance(item, dict) and clean_text(item.get("menuActionId")) == menu_action_id and clean_text(item.get("digit")) == digit:
            return {"label": clean_text(item.get("label")), "description": clean_text(item.get("description"))}
    for menu in ai_organizer.get("menuLabels", []) or []:
        if not isinstance(menu, dict) or clean_text(menu.get("menuActionId")) != menu_action_id:
            continue
        for option in menu.get("options", []) or []:
            if isinstance(option, dict) and clean_text(option.get("digit")) == digit:
                return {"label": clean_text(option.get("label")), "description": clean_text(option.get("description"))}
    return {"label": "", "description": ""}


def extract_real_menu_options(menu_action: Optional[Dict[str, Any]], semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any]) -> List[Dict[str, Any]]:
    if not menu_action:
        return []
    menu_id = clean_text(menu_action.get("actionId"))
    execution_model = semantic_model.get("executionModel") if isinstance(semantic_model.get("executionModel"), dict) else {}
    if execution_model:
        execution_options = extract_menu_options_from_execution(menu_action, execution_model, ExecutionContext())
        if execution_options:
            for item in execution_options:
                item["label"] = short_label(infer_main_menu_option_label(item, menu_action, semantic_model, ai_organizer), 70)
            remove_common_label_prefix(execution_options)
            return execution_options[:12]
    dispatcher = find_menu_dispatcher(menu_id, semantic_model)
    options: List[Dict[str, Any]] = []
    option_by_digit: Dict[str, Dict[str, Any]] = {}

    def add_option(digit: str, source: str, target: str = "", case_data: Optional[Dict[str, Any]] = None) -> None:
        value = clean_text(digit)
        if not value:
            return
        assignments = (case_data or {}).get("assignments") or {}
        next_step = assignment_value(assignments, ["NEXT_STEP", "next_step", "nextStep"])
        transfer_code = assignment_value(assignments, ["TRANSFERCODE", "TransferCode", "transferCode"])
        audio = assignment_value(assignments, ["AUDIO", "audio", "NOTEMENU", "noteini", "noteinc", "noteINV", "notesil", "noteREJ", "menu_audio1", "menu_audio2", "audio_menu1", "audio_menu2", "audio_menu3"])
        existing = option_by_digit.get(value)
        if existing:
            if clean_text(target) and not clean_text(existing.get("targetActionId")):
                existing["targetActionId"] = clean_text(target)
            if next_step:
                existing["nextStep"] = next_step
            if transfer_code:
                existing["transferCode"] = transfer_code
            if audio:
                existing["audio"] = audio
            if case_data:
                existing["case"] = case_data
            evidence = existing.setdefault("evidence", [])
            evidence.append(source)
            existing["source"] = "; ".join([clean_text(existing.get("source")), source]).strip("; ")
            existing["label"] = short_label(infer_main_menu_option_label(existing, menu_action, semantic_model, ai_organizer), 70)
            return
        ai_label = ai_menu_option_label(ai_organizer, menu_id, value)
        label_seed = ai_label.get("label") or subject_from_skill_name(transfer_code) or audio_subject_from_path(audio) or next_step or f"Opcao {value}"
        if clean_text(label_seed) == value and "transfer" in clean_text(next_step).lower():
            label_seed = "Transferencia"
        option = {
            "digit": value,
            "label": short_label(label_seed, 70),
            "description": ai_label.get("description") or short_label(next_step or transfer_code or source, 90),
            "targetActionId": clean_text(target),
            "source": source,
            "case": case_data or {},
            "audio": audio,
            "nextStep": next_step,
            "transferCode": transfer_code,
            "evidence": [f"MENU ActionID {menu_id}", source],
        }
        option["label"] = short_label(infer_main_menu_option_label(option, menu_action, semantic_model, ai_organizer), 70)
        option_by_digit[value] = option
        options.append(option)

    for index, case in enumerate(menu_action.get("cases") or [], start=1):
        digit = clean_text(case.get("value") or case.get("name") or index)
        add_option(digit, f"MENU.Cases / CASE {digit}", clean_text(case.get("target")))
    for item in dispatcher.get("switchCases") or []:
        for value in item.get("caseValues") or []:
            add_option(value, f"SWITCH {clean_text(item.get('switchVariable')) or 'CASE'} / CASE {value}", dispatcher.get("actionId"), item)
    for value in dispatcher.get("maskOptions") or []:
        add_option(value, f"MASCARA / LOCATE {value}", dispatcher.get("actionId"))
    remove_common_label_prefix(options)
    return options[:12]


def resolve_audio_reference(action_id: str, value: str, semantic_model: Dict[str, Any]) -> str:
    text = clean_text(value)
    if not text:
        return ""
    if ".wav" in text.lower():
        return re.split(r"[\\/]", text)[-1].strip("\"'")
    variable = text.strip("{}")
    actions_map = action_by_id(semantic_model)
    order, _levels = navigation_order(semantic_model)
    source_index = order.index(action_id) if action_id in order else len(order)
    assignments: Dict[str, str] = {}
    for aid in order[: source_index + 1]:
        action = actions_map.get(aid)
        if action:
            assignments.update(parse_assignments(action_code(action)))
    current = variable
    visited = set()
    for _ in range(8):
        if current in visited:
            break
        visited.add(current)
        candidate = assignments.get(current) or assignments.get(current.upper()) or assignments.get(current.lower())
        if not candidate:
            break
        candidate = clean_assignment_value(candidate)
        if ".wav" in candidate.lower():
            return re.split(r"[\\/]", candidate)[-1].strip("\"'")
        current = candidate.strip("{}")
    return text


def step_from_action(action: Dict[str, Any], semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any], edge_label_value: str = "", trace_context: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    aid = clean_text(action.get("actionId"))
    atype = clean_text(action.get("type")).upper()
    output = summarize_action_output(action)
    trace_context = trace_context or {}
    audio = {"fileName": "", "transcription": "", "origin": ""}
    for reference in action_audio_references(action):
        audio = resolve_audio_with_trace_context(reference, trace_context, semantic_model, f"ActionID {aid}")
        if clean_text(audio.get("fileName")) or clean_text(audio.get("mode")) == "dynamic":
            break
    if not clean_text(audio.get("fileName")) and clean_text(audio.get("mode")) != "dynamic" and output.get("audio"):
        audio = resolve_audio_with_trace_context(output.get("audio"), trace_context, semantic_model, f"ActionID {aid}")
    if not clean_text(audio.get("fileName")) and clean_text(audio.get("mode")) != "dynamic":
        direct = audio_context_for_action(action, semantic_model)
        if clean_text(direct.get("fileName")) and not is_auxiliary_audio_file(direct.get("fileName")):
            audio = direct
    label = friendly_action_label(action, ai_organizer)
    condition_label = ""
    if atype == "IF":
        label, condition_label = humanize_if_for_display(action, ai_organizer)
    elif atype == "HOURS":
        label = hours_display_label(action)
    if atype == "RUNSCRIPT":
        label = "Executa proximo passo"
    elif atype in {"RUNSUB", "REST_API"}:
        label = "Consulta API / integracao"
    elif atype == "REQAGENT":
        label = "Transfere para atendimento"
    return {
        "type": atype.lower() or "action",
        "actionId": aid,
        "label": label,
        "displayLabel": label,
        "technicalLabel": f"{atype} ActionID {aid}",
        "conditionLabel": condition_label,
        "businessDescription": clean_text(ai_display_label_for_action(aid, ai_organizer).get("businessDescription")),
        "edgeLabel": human_branch_label(edge_label_value),
        "audio": audio,
        "audioResolvedFrom": clean_text(audio.get("resolvedFrom") or audio.get("origin")),
        "contextSnapshot": context_snapshot(trace_context),
        "nextStep": output.get("nextStep"),
        "transferCode": output.get("transferCode"),
        "skillId": output.get("skillId"),
        "skillName": output.get("skillName"),
        "resolvedTarget": output.get("nextStep") or output.get("transferCode") or output.get("skillName"),
        "evidence": [f"ActionID {aid}"],
    }


def initial_trace_context(option: Dict[str, Any]) -> Dict[str, str]:
    digit = clean_text(option.get("digit"))
    return {
        "NOTEMENU": "",
        "noteini": "",
        "noteinc": "",
        "notesil": "",
        "noteINV": "",
        "noteREJ": "",
        "noteplay": "",
        "MRES": digit,
        "MRES1": "",
        "MRES2": "",
        "MRES3": "",
        "MRESF": "",
        "MRESF1": "",
        "audio": "",
        "AUDIO": clean_text(option.get("audio")),
        "audio_menu1": "",
        "menu_audio1": "",
        "menu_audio2": "",
        "audio_menu2": "",
        "audio_menu3": "",
        "audio_aviso": "",
        "audio_aviso2": "",
        "SKILL_ID": "",
        "SKILL_NAME": "",
        "Transfer_skill": "",
        "NEXT_STEP": clean_text(option.get("nextStep")),
        "TransferCode": clean_text(option.get("transferCode")),
        "scriptpoint": "",
        "mapa_dna": "",
    }


def execution_context_from_trace(trace_context: Optional[Dict[str, str]] = None, option: Optional[Dict[str, Any]] = None) -> ExecutionContext:
    ctx = ExecutionContext()
    ctx.variables.update(dict(trace_context or {}))
    digit = clean_text((option or {}).get("digit") or ctx.get("MRES"))
    if digit:
        ctx.path_digits.append(digit)
        ctx.set("MRES", digit)
    return ctx


def resolve_value_from_context(value: Any, context: Any) -> str:
    text = clean_assignment_value(value)
    if not text:
        return ""

    def lookup(key: str) -> str:
        if isinstance(context, ExecutionContext):
            return context.get(key)
        if isinstance(context, dict):
            return clean_text(context.get(key) or context.get(key.upper()) or context.get(key.lower()))
        return ""

    def repl(match: re.Match) -> str:
        key = clean_text(match.group(1))
        return lookup(key) or match.group(0)

    return re.sub(r"\{([^}]+)\}", repl, text)


def resolve_context_value(value: Any, trace_context: Dict[str, str]) -> str:
    return resolve_value_from_context(value, trace_context)


def update_trace_context_from_assignments(trace_context: Dict[str, str], assignments: Dict[str, str]) -> None:
    ctx = execution_context_from_trace(trace_context)
    ctx.apply_assignments(assignments)
    trace_context.update(ctx.variables)
    if ctx.last_audio:
        trace_context["__last_audio"] = ctx.last_audio
    if ctx.last_next_step:
        trace_context["__last_next_step"] = ctx.last_next_step


def case_matches_context(case_values: List[str], trace_context: Dict[str, str], switch_variable: str, option_digit: str) -> bool:
    if not case_values:
        return False
    switch_value = clean_text(trace_context.get(switch_variable) or trace_context.get(switch_variable.upper()))
    candidates = [switch_value] if switch_value else []
    if not switch_value and switch_variable:
        lower_value = clean_text(trace_context.get(switch_variable.lower()))
        if lower_value:
            candidates.append(lower_value)
    if not candidates and clean_text(switch_variable).upper() in {"MRES", "OP_ESCOLHIDA", "OPCAO", "OPÇÃO"}:
        candidates.append(option_digit)
    return any(clean_text(value) in candidates for value in case_values)


def apply_matching_switch_case(action: Dict[str, Any], trace_context: Dict[str, str], option_digit: str) -> Optional[Dict[str, Any]]:
    cases = parse_switch_case_tree(action_code(action))
    if not cases:
        return None
    selected = None
    for item in cases:
        if case_matches_context(item.get("caseValues") or [], trace_context, clean_text(item.get("switchVariable")), option_digit):
            selected = item
            break
    if selected is None:
        selected = next((item for item in cases if not item.get("caseValues") and item.get("assignments")), None)
    if selected:
        update_trace_context_from_assignments(trace_context, selected.get("assignments") or {})
    return selected


def choose_main_navigation_edge(action: Dict[str, Any], outgoing_edges: List[Dict[str, Any]], trace_context: Dict[str, str], option_digit: str) -> Optional[Dict[str, Any]]:
    if not outgoing_edges:
        return None
    atype = clean_text(action.get("type")).upper()
    labels = [(edge, edge_label_text(edge).lower()) for edge in outgoing_edges]

    def first_label(*wanted: str) -> Optional[Dict[str, Any]]:
        wanted_set = {item.lower() for item in wanted}
        return next((edge for edge, label in labels if label in wanted_set), None)

    if atype == "HOURS":
        return next((edge for edge, label in labels if is_open_hours_branch(label)), None) or default_edge_from_list(outgoing_edges)
    if atype == "LOCATE":
        return first_label("found", "encontrado") or default_edge_from_list(outgoing_edges)
    if atype == "IF":
        return first_label("true", "sim") or first_label("false", "nao", "não") or default_edge_from_list(outgoing_edges)
    if atype == "MENU":
        capture_var = clean_text(menu_variable(action.get("parameters"))).upper()
        if capture_var in {"MRES1", "MRES2", "MRES3", "MRESF"} and not trace_context_get(trace_context, capture_var):
            return None
        return default_edge_from_list(outgoing_edges)
    if atype == "LOOP":
        non_treatment = [edge for edge in outgoing_edges if not is_side_treatment_edge(action, edge)]
        return default_edge_from_list(non_treatment)
    if atype == "CASE":
        for case in action.get("cases") or []:
            if clean_text(case.get("value") or case.get("name")) == option_digit:
                target = clean_text(case.get("target"))
                edge = next((item for item in outgoing_edges if clean_text(item.get("target")) == target), None)
                if edge:
                    return edge
        return default_edge_from_list(outgoing_edges)
    return (
        first_label("default", "")
        or first_label("found", "true", "open")
        or default_edge_from_list(outgoing_edges)
    )


def default_edge_from_list(edges: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    return sorted(edges, key=lambda edge: 0 if edge_label_text(edge).lower() in {"", "default"} else 1)[0] if edges else None


def collect_side_treatments(action: Dict[str, Any], outgoing_edges: List[Dict[str, Any]], main_edge: Optional[Dict[str, Any]]) -> List[Dict[str, str]]:
    treatments = []
    if is_hours_action(action):
        return treatments
    main_target = clean_text((main_edge or {}).get("target"))
    for edge in outgoing_edges:
        target = clean_text(edge.get("target"))
        label = edge_label_text(edge).lower()
        if target == main_target:
            continue
        if is_side_treatment_edge(action, edge):
            treatments.append({"label": human_branch_label(label), "targetActionId": target, "kind": "side_treatment"})
    return treatments


def hours_branch_signature(branch: Dict[str, Any]) -> Tuple[Any, ...]:
    blocks = []
    for block in branch.get("blocks") or []:
        audio = block.get("audio") if isinstance(block.get("audio"), dict) else {}
        blocks.append(
            (
                clean_text(block.get("type")).lower(),
                clean_text(block.get("resolvedTarget") or block.get("nextStep") or block.get("transferCode")),
                clean_text(audio.get("fileName")).lower(),
                clean_display_text(block.get("displayLabel") or block.get("label")).lower(),
            )
        )
    terminal = branch.get("terminal") if isinstance(branch.get("terminal"), dict) else {}
    return tuple(blocks + [(clean_text(terminal.get("type")).lower(), clean_text(terminal.get("label")).lower())])


def merge_equivalent_hours_side_branches(side_branches: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    grouped: Dict[Tuple[Any, ...], Dict[str, Any]] = {}
    order: List[Tuple[Any, ...]] = []
    for branch in side_branches:
        signature = hours_branch_signature(branch)
        if signature not in grouped:
            grouped[signature] = {**branch, "branchTypes": list(branch.get("branchTypes") or [clean_text(branch.get("rawLabel") or branch.get("label"))])}
            order.append(signature)
            continue
        existing = grouped[signature]
        labels = [clean_text(item) for item in re.split(r"\s*/\s*", clean_text(existing.get("label"))) if clean_text(item)]
        label = clean_text(branch.get("label"))
        if label and label not in labels:
            labels.append(label)
        existing["label"] = "/".join(labels)
        existing.setdefault("evidence", []).extend(item for item in branch.get("evidence") or [] if item not in existing.get("evidence", []))
        existing.setdefault("branchTypes", []).extend(
            item for item in (branch.get("branchTypes") or [clean_text(branch.get("rawLabel") or branch.get("label"))]) if item not in existing.get("branchTypes", [])
        )
    return [grouped[key] for key in order]


def trace_hours_branch_outcome(
    hours_action: Dict[str, Any],
    branch: Dict[str, Any],
    semantic_model: Dict[str, Any],
    trace_context: Dict[str, str],
    ai_organizer: Dict[str, Any],
    max_depth: int = 14,
) -> Dict[str, Any]:
    actions_map, adjacency, _incoming = build_navigation_maps(semantic_model)
    raw_label = edge_label_text(branch)
    target_id = clean_text(branch.get("target"))
    local_context = dict(trace_context or {})
    current_id = target_id
    visited: set = set()
    blocks: List[Dict[str, Any]] = []
    terminal: Dict[str, str] = {}
    evidence = [f"HOURS {clean_text(hours_action.get('actionId'))} {clean_text(raw_label)} -> {target_id}"]
    depth = 0
    while current_id and depth < max_depth:
        if current_id in visited:
            terminal = {"type": "loop", "label": "Retorno para ponto visitado", "actionId": current_id}
            blocks.append(
                {
                    "type": "loop",
                    "actionId": current_id,
                    "displayLabel": "Retorno para ponto visitado",
                    "evidence": [f"ActionID {current_id}"],
                    "context": dict(local_context),
                }
            )
            break
        visited.add(current_id)
        action = actions_map.get(current_id)
        if not action:
            terminal = {"type": "external", "label": current_id, "actionId": current_id}
            blocks.append(
                {
                    "type": "continuation",
                    "actionId": current_id,
                    "displayLabel": "Destino não detalhado",
                    "secondaryLabel": current_id,
                    "evidence": [f"Target {current_id}"],
                    "context": dict(local_context),
                }
            )
            break
        selected_case = apply_matching_switch_case(action, local_context, clean_text(local_context.get("MRES")))
        atype = clean_text(action.get("type")).upper()
        output = summarize_action_output(action)
        assignments = parse_assignments(action_code(action))
        if output:
            update_trace_context_from_assignments(local_context, {key: value for key, value in output.items() if clean_text(value)})
        if assignments:
            update_trace_context_from_assignments(local_context, assignments)

        should_add = False
        step = step_from_action(action, semantic_model, ai_organizer, edge_label_value=raw_label, trace_context=local_context)
        step["context"] = dict(local_context)
        step["contextSnapshot"] = context_snapshot(local_context)
        if selected_case:
            step["matchedCase"] = {
                "switchVariable": selected_case.get("switchVariable"),
                "caseValues": selected_case.get("caseValues") or [],
                "caseRangeLabel": selected_case.get("caseRangeLabel"),
            }

        if atype == "PLAY":
            audio = resolve_audio_for_step(step, local_context, semantic_model)
            step["type"] = "play"
            step["displayLabel"] = humanize_hours_play(action, audio)
            step["audio"] = audio
            should_add = True
        elif atype == "END":
            step["type"] = "end"
            step["displayLabel"] = "Fim"
            should_add = True
            terminal = {"type": "end", "label": "Fim", "actionId": current_id}
        elif atype == "RUNSCRIPT":
            resolved = clean_text(output.get("nextStep") or local_context.get("NEXT_STEP") or local_context.get("__last_next_step") or action.get("caption"))
            step["type"] = "runscript"
            step["displayLabel"] = "Executa próximo fluxo"
            step["resolvedTarget"] = resolved
            step["nextStep"] = resolved
            should_add = True
            terminal = {"type": "runscript", "label": resolved or "Próximo fluxo", "actionId": current_id}
        elif atype == "REQAGENT":
            skill = clean_text(output.get("skillName") or output.get("skillId") or local_context.get("SKILL_NAME") or local_context.get("SKILL_ID"))
            step["type"] = "reqagent"
            step["displayLabel"] = "Transferência"
            step["secondaryLabel"] = skill
            should_add = True
            terminal = {"type": "reqagent", "label": skill or "Transferência", "actionId": current_id}
        elif atype in {"REST_API", "RUNSUB"}:
            step["type"] = "api"
            step["displayLabel"] = "Consulta API / integração"
            should_add = True
            terminal = {"type": atype.lower(), "label": clean_text(action.get("caption")) or step["displayLabel"], "actionId": current_id}
        elif atype == "MENU":
            step["type"] = "menu"
            step["displayLabel"] = "Segue para menu"
            step["secondaryLabel"] = clean_option_label_token(action.get("caption"))
            should_add = True
            terminal = {"type": "menu", "label": step["secondaryLabel"] or "Menu", "actionId": current_id}
        elif atype in {"IF", "HOURS"}:
            step["type"] = "decision"
            step["displayLabel"] = hours_display_label(action) if atype == "HOURS" else humanize_if_short(action, ai_organizer)[0]
            step["hideCondition"] = atype == "HOURS"
            should_add = True
            terminal = {"type": "decision", "label": step["displayLabel"], "actionId": current_id}
        elif atype == "SNIPPET" and any(clean_text(output.get(key)) for key in ["audio", "nextStep", "transferCode", "skillId", "skillName"]):
            step["type"] = "process"
            step["displayLabel"] = clean_text(step.get("displayLabel")) or friendly_action_label(action, ai_organizer)
            should_add = True
        elif not is_technical_noise_action(action) and atype not in {"ONANSWER", "ONRELEASE"}:
            should_add = True

        if should_add:
            blocks.append(step)
        if terminal:
            break
        if atype == "CASE":
            matched_target = ""
            for case in action.get("cases") or []:
                case_value = clean_text(case.get("value") or case.get("name"))
                switch_value = clean_text(local_context.get("MRESF1") or local_context.get("MRESF") or local_context.get("MRES3") or local_context.get("MRES2") or local_context.get("MRES1") or local_context.get("MRES"))
                if case_value and case_value == switch_value:
                    matched_target = clean_text(case.get("target"))
                    break
            if matched_target:
                current_id = matched_target
                depth += 1
                continue
        main_edge = choose_main_navigation_edge(action, adjacency.get(current_id, []), local_context, clean_text(local_context.get("MRES")))
        if not main_edge:
            break
        current_id = clean_text(main_edge.get("target"))
        depth += 1
    if not blocks and target_id:
        blocks.append(
            {
                "type": "continuation",
                "actionId": target_id,
                "displayLabel": "Destino não detalhado",
                "secondaryLabel": target_id,
                "evidence": [f"Target {target_id}"],
                "context": dict(local_context),
            }
        )
    return {
        "branchLabel": human_hours_branch_label(raw_label),
        "label": human_hours_branch_label(raw_label),
        "rawLabel": clean_text(raw_label),
        "branchType": "open" if is_open_hours_branch(raw_label) else "unavailable" if is_unavailable_hours_branch(raw_label) else "other",
        "branchTypes": [clean_text(raw_label)],
        "targetActionId": target_id,
        "blocks": blocks[:6],
        "terminal": terminal,
        "evidence": evidence,
    }


def extract_hours_treatments_for_step(
    step_or_action: Dict[str, Any],
    semantic_model: Dict[str, Any],
    trace_context: Dict[str, str],
    ai_organizer: Dict[str, Any],
) -> Dict[str, Any]:
    actions_map, adjacency, _incoming = build_navigation_maps(semantic_model)
    action_id = clean_text(step_or_action.get("actionId"))
    action = actions_map.get(action_id) or step_or_action
    if not is_hours_action(action):
        return {}
    outgoing = adjacency.get(clean_text(action.get("actionId")), [])
    if not outgoing:
        return {
            "hoursKey": hours_key(action),
            "displayLabel": hours_display_label(action),
            "mainBranch": {},
            "sideBranches": [],
            "evidence": [f"ActionID {clean_text(action.get('actionId'))}", f"HOURS {hours_key(action)}"],
        }
    main_edge = next((edge for edge in outgoing if is_open_hours_branch(edge_label_text(edge))), None)
    evidence = [f"ActionID {clean_text(action.get('actionId'))}", f"HOURS {hours_key(action)}"]
    if main_edge is None:
        main_edge = outgoing[0]
        evidence.append("HOURS sem branch Open identificada.")
    main_target = clean_text((main_edge or {}).get("target"))
    side_branches = [
        trace_hours_branch_outcome(action, edge, semantic_model, dict(trace_context or {}), ai_organizer)
        for edge in outgoing
        if clean_text(edge.get("target")) != main_target
    ]
    return {
        "hoursKey": hours_key(action),
        "displayLabel": hours_display_label(action),
        "conditionLabel": "",
        "hideCondition": True,
        "mainBranch": {
            "label": human_hours_branch_label(edge_label_text(main_edge or {})),
            "targetActionId": main_target,
        },
        "sideBranches": merge_equivalent_hours_side_branches(side_branches),
        "evidence": evidence,
    }


def trace_deep_option_flow(option: Dict[str, Any], menu_action: Optional[Dict[str, Any]], dispatcher: Dict[str, Any], semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any]) -> Dict[str, Any]:
    actions_map, adjacency, _incoming = build_navigation_maps(semantic_model)
    raw_steps: List[Dict[str, Any]] = []
    side_treatments: List[Dict[str, str]] = []
    digit = clean_text(option.get("digit"))
    dispatcher_id = clean_text(dispatcher.get("actionId"))
    trace_context = initial_trace_context(option)
    if isinstance(option.get("executionContext"), dict):
        trace_context.update({clean_text(key): clean_text(value) for key, value in option.get("executionContext", {}).items() if clean_text(key) and clean_text(value)})
        if digit:
            trace_context["MRES"] = digit
    case_data = option.get("case") if isinstance(option.get("case"), dict) else {}
    if case_data:
        assignments = case_data.get("assignments") or {}
        update_trace_context_from_assignments(trace_context, assignments)
        audio = assignment_value(assignments, ["AUDIO", "audio", "NOTEMENU", "noteini", "noteinc", "noteINV", "notesil", "noteREJ", "menu_audio1", "menu_audio2", "audio_menu1", "audio_menu2", "audio_menu3"])
        raw_steps.append(
            {
                "type": "snippet_case",
                "actionId": dispatcher_id,
                "label": f"Define saida da opcao {digit}",
                "displayLabel": "Define saida da opcao",
                "technicalLabel": f"SNIPPET ActionID {dispatcher_id}",
                "conditionLabel": f"Opcao {digit}",
                "businessDescription": "Define audio, proximo destino e parametros da opcao escolhida.",
                "source": option.get("source"),
                "audio": resolve_audio_with_trace_context(audio, trace_context, semantic_model, f"CASE {digit}") if audio else {},
                "audioResolvedFrom": clean_text(audio),
                "contextSnapshot": context_snapshot(trace_context),
                "nextStep": option.get("nextStep"),
                "transferCode": option.get("transferCode"),
                "resolvedTarget": option.get("nextStep") or option.get("transferCode"),
                "evidence": [f"ActionID {dispatcher_id}", clean_text(option.get("source"))],
                "context": dict(trace_context),
            }
        )
    current_id = clean_text(option.get("targetActionId")) or dispatcher_id
    visited_counts: Dict[str, int] = {}
    terminal: Dict[str, str] = {}
    while current_id and len(raw_steps) < 60:
        visited_counts[current_id] = visited_counts.get(current_id, 0) + 1
        if visited_counts[current_id] > 2:
            terminal = {"type": "loop", "actionId": current_id, "label": "Retorno para ponto ja visitado"}
            break
        action = actions_map.get(current_id)
        if not action:
            terminal = {"type": "external", "actionId": current_id, "label": clean_text(current_id)}
            break
        selected_case = apply_matching_switch_case(action, trace_context, digit)
        if not (raw_steps and raw_steps[-1].get("type") == "snippet_case" and raw_steps[-1].get("actionId") == current_id):
            step = step_from_action(action, semantic_model, ai_organizer, trace_context=trace_context)
            step["context"] = dict(trace_context)
            step["contextSnapshot"] = context_snapshot(trace_context)
            if selected_case:
                step["matchedCase"] = {
                    "switchVariable": selected_case.get("switchVariable"),
                    "caseValues": selected_case.get("caseValues") or [],
                    "caseRangeLabel": selected_case.get("caseRangeLabel"),
                }
            if is_hours_action(action):
                step.update(extract_hours_treatments_for_step(action, semantic_model, trace_context, ai_organizer))
            raw_steps.append(step)
        atype = clean_text(action.get("type")).upper()
        output = summarize_action_output(action)
        if output:
            update_trace_context_from_assignments(trace_context, {k: v for k, v in output.items() if clean_text(v)})
        if atype in {"END", "REQAGENT"}:
            terminal = {"type": atype.lower(), "actionId": current_id, "label": friendly_action_label(action, ai_organizer)}
            break
        if atype in {"REST_API", "RUNSUB"} and len(raw_steps) > 6:
            terminal = {"type": atype.lower(), "actionId": current_id, "label": friendly_action_label(action, ai_organizer)}
            break
        if atype == "RUNSCRIPT" and (output.get("nextStep") or "{NEXT_STEP}" in action_code(action)):
            resolved_next = clean_text(output.get("nextStep") or trace_context.get("NEXT_STEP") or trace_context.get("__last_next_step"))
            resolved_transfer = clean_text(output.get("transferCode") or trace_context.get("TRANSFERCODE") or trace_context.get("TransferCode"))
            if resolved_next:
                raw_steps[-1]["resolvedTarget"] = resolved_next
                raw_steps[-1]["targetType"] = "next_step"
            elif resolved_transfer:
                raw_steps[-1]["resolvedTarget"] = resolved_transfer
                raw_steps[-1]["transferCode"] = resolved_transfer
                raw_steps[-1]["targetType"] = "transfer_code"
            elif len(raw_steps) >= 2 and clean_text(raw_steps[-2].get("resolvedTarget")):
                raw_steps[-1]["resolvedTarget"] = clean_text(raw_steps[-2].get("resolvedTarget"))
                raw_steps[-1]["targetType"] = clean_text(raw_steps[-2].get("targetType") or "next_step")
            terminal = {
                "type": clean_text(raw_steps[-1].get("targetType") or "runscript"),
                "actionId": current_id,
                "label": clean_text(raw_steps[-1].get("resolvedTarget")),
            }
            break
        if atype == "CASE":
            matched_target = ""
            for case in action.get("cases") or []:
                case_value = clean_text(case.get("value") or case.get("name"))
                switch_value = clean_text(trace_context.get("MRESF1") or trace_context.get("MRESF") or trace_context.get("MRES3") or trace_context.get("MRES2") or trace_context.get("MRES1") or digit)
                if case_value in {digit, switch_value}:
                    matched_target = clean_text(case.get("target"))
                    break
            if matched_target:
                current_id = matched_target
                continue
        outgoing = adjacency.get(current_id, [])
        main_edge = choose_main_navigation_edge(action, outgoing, trace_context, digit)
        if not is_hours_action(action):
            side_treatments.extend(collect_side_treatments(action, outgoing, main_edge))
        if not main_edge:
            terminal = {"type": "terminal", "actionId": current_id, "label": friendly_action_label(action, ai_organizer)}
            break
        current_id = clean_text(main_edge.get("target"))
    visible_steps = compact_navigation_steps(raw_steps, semantic_model, ai_organizer, trace_context)
    return {
        "digit": digit,
        "label": clean_text(option.get("label") or f"Opcao {digit}"),
        "description": clean_text(option.get("description")),
        "source": clean_text(option.get("source")),
        "targetActionId": clean_text(option.get("targetActionId")),
        "rawSteps": raw_steps[:60],
        "steps": raw_steps[:60],
        "visibleSteps": visible_steps,
        "sideTreatments": side_treatments[:12],
        "terminal": terminal,
        "variablesContext": trace_context,
        "evidence": option.get("evidence") or [],
    }


def trace_option_flow(option: Dict[str, Any], menu_action: Optional[Dict[str, Any]], dispatcher: Dict[str, Any], semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any]) -> Dict[str, Any]:
    return trace_deep_option_flow(option, menu_action, dispatcher, semantic_model, ai_organizer)


def visible_step_key(step: Dict[str, Any]) -> Tuple[str, str, str]:
    return (
        clean_text(step.get("type")).lower(),
        clean_display_text(step.get("displayLabel") or step.get("label")).lower(),
        clean_text((step.get("audio") or {}).get("fileName")).lower(),
    )


def humanize_play_node(action: Dict[str, Any], semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any]) -> Dict[str, Any]:
    audio = audio_context_for_action(action, semantic_model)
    text = " ".join([clean_text(action.get("caption")), clean_text(audio.get("fileName")), action_code(action)]).lower()
    if "tchau" in text or "desliga" in text or "encerra" in text:
        label = "Tchau"
    elif any(token in text for token in ["semexpediente", "sem_expediente", "feriado", "fechado", "emergencial"]):
        label = "Audio fechado ou feriado"
    elif any(token in text for token in ["aviso", "informativo", "mensagem", "msg"]):
        label = "Play aviso"
    else:
        subject = audio_subject_from_path(audio.get("fileName"))
        if subject and subject.lower().startswith("play "):
            label = subject
        else:
            label = f"Play {subject}" if subject else clean_display_text(ai_display_label_for_action(clean_text(action.get("actionId")), ai_organizer).get("displayLabel")) or "Play aviso"
    return {"displayLabel": label, "audio": audio}


def compact_step_from_raw(raw_step: Dict[str, Any], action: Optional[Dict[str, Any]], semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    atype = clean_text((action or {}).get("type") or raw_step.get("type")).upper()
    if action and should_hide_from_main_flow(action):
        return None
    display_node = build_display_node_from_action(action, semantic_model, ai_organizer) if action else {
        "displayLabel": raw_step.get("displayLabel") or raw_step.get("label"),
        "conditionLabel": raw_step.get("conditionLabel", ""),
        "audio": raw_step.get("audio") or {},
        "hideFromMainFlow": False,
    }
    if display_node.get("hideFromMainFlow"):
        return None

    context = raw_step.get("context") or {}
    label = clean_display_text(display_node.get("displayLabel"))
    secondary = clean_display_text(display_node.get("secondaryLabel"))
    audio = resolve_audio_for_step(raw_step, raw_step.get("context") or {}, semantic_model)
    if not clean_text(audio.get("fileName")) and clean_text(audio.get("mode")) != "dynamic":
        audio = display_node.get("audio") or raw_step.get("audio") or {}
    kind = clean_text(raw_step.get("type") or atype).lower()

    if raw_step.get("type") == "snippet_case":
        label = "Define saida da opcao"
        kind = "process"
        audio = raw_step.get("audio") or {}
    elif atype == "HOURS":
        kind = "decision"
        label = clean_display_text(raw_step.get("displayLabel")) or hours_display_label(action)
        secondary = ""
    elif atype == "MENU":
        kind = "menu"
        if action and is_collect_action(action):
            label = humanize_collect_menu(action, semantic_model, ai_organizer)
            kind = "collect"
        else:
            caption = clean_text((action or {}).get("caption"))
            variable = menu_variable((action or {}).get("parameters"))
            if clean_text(variable).upper() in {"MRES1", "MRES2", "MRES3", "MRESF"}:
                suffix = clean_text(variable).upper().replace("MRES", "")
                label = f"Menu {suffix} / {clean_text(variable).upper()}" if suffix else f"Menu / {clean_text(variable).upper()}"
            else:
                label = caption if caption and not is_generic_technical_label(caption) else "Menu"
            secondary = clean_text(variable or secondary)
    elif atype == "IF":
        kind = "decision"
        label, secondary = humanize_if_short(action or {}, ai_organizer)
        technical_condition = secondary
        hide_condition = False
        condition_text = action_search_text(action)
        if re.search(r"\bcel\b.*==\s*[\"']?1", condition_text) or "cel==\"1\"" in condition_text:
            label = "Digitar celular, se necessario"
            hide_condition = True
        if "transfer_skill" in action_search_text(action):
            label = "Transfer_skill?"
            hide_condition = True
        if "checkcpf" in condition_text.lower() or "checkmobile" in condition_text.lower():
            hide_condition = True
        if hide_condition:
            secondary = ""
    elif atype == "PLAY":
        kind = "play"
        label = humanize_play_node(action or {}, semantic_model, ai_organizer).get("displayLabel") or "Play aviso"
    elif atype in {"RUNSUB", "REST_API"}:
        kind = "api"
    elif atype == "REQAGENT":
        kind = "transfer"
        skill = clean_text(context.get("SKILL_NAME") or context.get("SkillName") or context.get("SKILL_ID") or raw_step.get("skillName") or raw_step.get("skillId"))
        label = "Transferencia para skill"
        secondary = skill
    elif atype == "RUNSCRIPT":
        kind = "transfer"
        label = "Executa proximo destino"
        secondary = clean_text(raw_step.get("resolvedTarget") or context.get("NEXT_STEP"))
    elif atype == "SNIPPET":
        output = summarize_action_output(action or {})
        if output.get("audio") or audio.get("fileName"):
            kind = "process"
            subject = audio_subject_from_path(audio.get("fileName"))
            label = f"Preparar audio de {subject}" if subject else "Preparar audio"
        elif output.get("nextStep") or context.get("NEXT_STEP"):
            kind = "process"
            label = "Define proximo destino"
            secondary = clean_text(output.get("nextStep") or context.get("NEXT_STEP"))
        elif output.get("skillId") or output.get("skillName") or context.get("SKILL_ID") or context.get("SKILL_NAME"):
            kind = "process"
            label = "Define skill"
            secondary = clean_text(output.get("skillName") or output.get("skillId") or context.get("SKILL_NAME") or context.get("SKILL_ID"))
        else:
            return None

    if not label:
        return None
    return {
        **raw_step,
        "type": kind,
        "displayLabel": label,
        "secondaryLabel": secondary,
        "conditionLabel": clean_display_text(display_node.get("conditionLabel")),
        "audio": audio,
        "audioResolvedFrom": clean_text(audio.get("resolvedFrom") or raw_step.get("audioResolvedFrom")),
        "contextSnapshot": raw_step.get("contextSnapshot") or context_snapshot(context),
        "hideFromMainFlow": False,
        "technicalCondition": clean_text(locals().get("technical_condition", "")),
        "hideCondition": bool(raw_step.get("hideCondition") or locals().get("hide_condition", False)),
        "hoursKey": raw_step.get("hoursKey"),
        "mainBranch": raw_step.get("mainBranch") or {},
        "sideBranches": raw_step.get("sideBranches") or [],
    }


def compact_navigation_steps(raw_steps: List[Dict[str, Any]], semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any], trace_context: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
    actions_map = action_by_id(semantic_model)
    visible: List[Dict[str, Any]] = []
    seen_consecutive: Optional[Tuple[str, str, str]] = None
    for raw_step in raw_steps:
        action = actions_map.get(clean_text(raw_step.get("actionId")))
        compacted = compact_step_from_raw(raw_step, action, semantic_model, ai_organizer)
        if not compacted:
            continue
        key = visible_step_key(compacted)
        if key == seen_consecutive:
            continue
        seen_consecutive = key
        visible.append(compacted)
        if len(visible) >= 18:
            break

    if len(raw_steps) > 0 and len(visible) >= 18:
        visible.append(
            {
                "type": "continuation",
                "displayLabel": "Continua nos mapas detalhados",
                "secondaryLabel": "Veja Mapa de Menus e Fluxograma Tecnico",
                "audio": {},
            }
        )
    return visible


def classify_subflow_actions(action_ids: List[str], semantic_model: Dict[str, Any], routes: List[Dict[str, Any]], digit: str, ai_organizer: Dict[str, Any]) -> List[Dict[str, Any]]:
    actions_map = action_by_id(semantic_model)
    route_items = [route for route in routes if (route.get("path") or [""])[0] == digit]
    children: List[Dict[str, Any]] = []

    def add(kind: str, label: str, items: List[str], action_ids_value: List[str]) -> None:
        cleaned = []
        for item in items:
            text = short_label(item, 55)
            if text and text not in cleaned:
                cleaned.append(text)
        if cleaned or label:
            children.append({"type": kind, "label": label, "items": cleaned[:6], "actionIds": action_ids_value[:8]})

    submenu_actions = [actions_map[aid] for aid in action_ids if aid in actions_map and clean_text(actions_map[aid].get("type")).upper() == "MENU"]
    if submenu_actions:
        add("submenu", "Submenus", [clean_text(action.get("businessLabel") or action.get("caption") or f"Menu {action.get('actionId')}") for action in submenu_actions[:4]], [clean_text(action.get("actionId")) for action in submenu_actions])

    collect_actions = [actions_map[aid] for aid in action_ids if aid in actions_map and is_collect_action(actions_map[aid])]
    if collect_actions:
        add("collect", "Coleta de dados", [action_story_label(action, ai_organizer) for action in collect_actions[:5]], [clean_text(action.get("actionId")) for action in collect_actions])

    if_actions = [actions_map[aid] for aid in action_ids if aid in actions_map and clean_text(actions_map[aid].get("type")).upper() == "IF"]
    if if_actions:
        add("validation", "Validacoes", [humanize_if_condition(action, ai_organizer) for action in if_actions[:5]], [clean_text(action.get("actionId")) for action in if_actions])

    audio_actions = [actions_map[aid] for aid in action_ids if aid in actions_map and audio_context_for_action(actions_map[aid], semantic_model).get("fileName")]
    if audio_actions:
        add("audio", "Audios / mensagens", [audio_context_for_action(action, semantic_model).get("fileName", "") for action in audio_actions[:4]], [clean_text(action.get("actionId")) for action in audio_actions])

    integration_actions = [
        actions_map[aid]
        for aid in action_ids
        if aid in actions_map and clean_text(actions_map[aid].get("type")).upper() in {"RUNSUB", "REST_API", "RUNSCRIPT", "REQAGENT"}
    ]
    route_destinations = [
        route.get("target", {}).get("skillName") or route.get("nextStep") or route.get("transferCode") or route.get("target", {}).get("actionId")
        for route in route_items
    ]
    if integration_actions or route_destinations:
        add(
            "transfer",
            "Transferencia / API / proximo script",
            [*(action_story_label(action, ai_organizer) for action in integration_actions[:4]), *(clean_text(item) for item in route_destinations if clean_text(item))],
            [clean_text(action.get("actionId")) for action in integration_actions],
        )

    route_subjects = [route.get("treatment") or route.get("pathLabel") for route in route_items]
    if route_subjects:
        add("topics", "Assuntos principais", [clean_text(item) for item in route_subjects[:8]], [clean_text(route.get("originMenuActionId")) for route in route_items])

    ending_actions = [
        actions_map[aid]
        for aid in action_ids
        if aid in actions_map and (clean_text(actions_map[aid].get("type")).upper() in {"END", "LOOP", "ONRELEASE"} or "desliga" in action_search_text(actions_map[aid]) or "tchau" in action_search_text(actions_map[aid]))
    ]
    if ending_actions:
        add("ending", "Encerramento / retorno", [action_story_label(action, ai_organizer) for action in ending_actions[:4]], [clean_text(action.get("actionId")) for action in ending_actions])

    return children[:6]


def build_subflow_tree_for_main_option(option: Dict[str, str], semantic_model: Dict[str, Any], human_routes: Dict[str, Any], ai_organizer: Dict[str, Any]) -> Dict[str, Any]:
    target = clean_text(option.get("targetActionId"))
    digit = clean_text(option.get("digit"))
    action_ids = reachable_action_ids(target, semantic_model, 70) if target else []
    if not action_ids and clean_text(option.get("routeActionId")):
        route_action = clean_text(option.get("routeActionId"))
        action_ids = reachable_action_ids(route_action, semantic_model, 35) or [route_action]
    return {
        "digit": digit,
        "label": clean_text(option.get("label") or f"Opcao {digit}"),
        "description": clean_text(option.get("description")),
        "targetActionId": target,
        "children": classify_subflow_actions(action_ids, semantic_model, human_routes.get("routes", []), digit, ai_organizer),
        "evidence": [clean_text(option.get("evidence"))],
    }


def fallback_main_options_from_routes(human_routes: Dict[str, Any], main_menu: Optional[Dict[str, Any]]) -> List[Dict[str, str]]:
    routes = human_routes.get("routes") or []
    options: List[Dict[str, str]] = []
    seen = set()
    main_id = clean_text((main_menu or {}).get("actionId"))
    for index, route in enumerate(routes, start=1):
        path = [clean_text(item) for item in route.get("path") or [] if clean_text(item)]
        digit = path[0] if path else str(index)
        route_key = digit
        if route_key in seen:
            continue
        treatment = clean_text(route.get("treatment") or route.get("pathLabel"))
        target = route.get("target") if isinstance(route.get("target"), dict) else {}
        destination = clean_text(target.get("skillName") or route.get("nextStep") or target.get("actionId"))
        if not treatment and not destination:
            continue
        seen.add(route_key)
        options.append(
            {
                "digit": digit,
                "label": short_label(treatment or destination or f"Opcao {digit}", 64),
                "description": short_label(destination, 80),
                "targetActionId": clean_text(target.get("actionId")),
                "routeActionId": clean_text(route.get("originMenuActionId")) if clean_text(route.get("originMenuActionId")) != main_id else "",
                "evidence": "; ".join(route.get("evidence") or [f"rota deterministica {route.get('routeId', index)}"]),
            }
        )
        if len(options) >= 8:
            break
    return options


def extract_attempts_from_text(text: str) -> str:
    candidates = [
        r"(?:QTD_MAX|MAX|MAX_?TENT|TENTATIVAS?|LOOP)\D{0,20}(\d+)",
        r"(\d+)\s*(?:tentativas?|vezes)",
    ]
    for pattern in candidates:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return f"ate {match.group(1)} tentativas"
    return ""


def extract_loop_treatments_for_menu(menu_action: Optional[Dict[str, Any]], semantic_model: Dict[str, Any]) -> List[Dict[str, str]]:
    if not menu_action:
        return []
    menu_id = clean_text(menu_action.get("actionId"))
    actions_map, adjacency, _incoming = build_navigation_maps(semantic_model)
    loop_ids = []
    for aid in reachable_action_ids(menu_id, semantic_model, 45):
        action = actions_map.get(aid)
        if not action:
            continue
        text = action_search_text(action)
        atype = clean_text(action.get("type")).upper()
        if atype == "LOOP" or any(token in text for token in ["loop", "max_sil", "maxsil", "max_inv", "maxinv", "maxrej", "qtd_max"]):
            loop_ids.append(aid)
    treatments: List[Dict[str, str]] = []
    for aid in loop_ids[:4]:
        action = actions_map.get(aid)
        if not action:
            continue
        text = action_search_text(action)
        repeat_target = ""
        finished_target = ""
        repeat_audio = ""
        finished_audio = ""
        for edge in adjacency.get(aid, []):
            label = edge_label_text(edge).lower()
            target = clean_text(edge.get("target"))
            target_action = actions_map.get(target)
            target_audio = audio_context_for_action(target_action, semantic_model).get("fileName") if target_action else ""
            if "repeat" in label or "invalid" in label or "sil" in label or "timeout" in label:
                repeat_target = target or repeat_target
                repeat_audio = target_audio or repeat_audio
            elif "finished" in label or "limit" in label or "max" in label:
                finished_target = target or finished_target
                finished_audio = target_audio or finished_audio
        if not repeat_target:
            for edge in adjacency.get(aid, []):
                target = clean_text(edge.get("target"))
                if target == menu_id:
                    repeat_target = target
                    break
        label = clean_option_label_token(action.get("caption")) or "Loop de tentativas"
        attempts = extract_attempts_from_text(text)
        finished_label = clean_option_label_token((actions_map.get(finished_target) or {}).get("caption")) or "Tchau/Fim"
        treatments.append(
            {
                "loopId": aid,
                "label": label if "loop" in label.lower() else f"Loop {label}",
                "attempts": attempts,
                "repeatLabel": "Repetir/Invalido",
                "finishedLabel": "Finalizado",
                "repeatTarget": repeat_target or menu_id,
                "finishedTarget": finished_target,
                "audioOnRepeat": repeat_audio,
                "audioOnFinished": finished_audio,
                "finishedTargetLabel": finished_label,
            }
        )
    return treatments


def infer_option_label_from_visible_steps(flow_item: Dict[str, Any]) -> str:
    generic = re.compile(r"\b(horario|cpf|digita\s*cpf|digitacpf|celular|digitar|valid|play|aviso|audio|transfer|skill|menu\s+\d|preparar|define|consulta|api|atualiza|variaveis|direciona|opcao escolhida|maxrej|maxsil|maxinv|maxinc)\b", re.IGNORECASE)
    candidates: List[str] = []
    for step in flow_item.get("visibleSteps") or []:
        label = clean_text(step.get("displayLabel") or step.get("label"))
        if not label or generic.search(label):
            audio_label = clean_option_label_token(audio_subject_from_path((step.get("audio") or {}).get("fileName")))
            if audio_label and not generic.search(audio_label):
                candidates.append(audio_label)
            continue
        normalized = clean_option_label_token(label)
        if normalized and not is_generic_technical_label(normalized) and not generic.search(normalized):
            candidates.append(normalized)
    return candidates[0] if candidates else ""


def refine_option_flow_labels(option_flows: List[Dict[str, Any]], main_options: List[Dict[str, Any]]) -> None:
    by_digit = {clean_text(option.get("digit")): option for option in main_options}
    for flow in option_flows:
        current = clean_text(flow.get("label"))
        if current and not current.lower().startswith("opcao ") and current.lower() not in {"cel", "cpf?", "cpf", "wav", "transf"} and not is_bad_option_label(current):
            continue
        traced = infer_option_label_from_visible_steps(flow)
        if traced and not is_bad_option_label(traced):
            flow["label"] = traced
            if clean_text(flow.get("digit")) in by_digit:
                by_digit[clean_text(flow.get("digit"))]["label"] = traced
        elif is_bad_option_label(current):
            flow["label"] = f"Opcao {clean_text(flow.get('digit'))}"
            if clean_text(flow.get("digit")) in by_digit:
                by_digit[clean_text(flow.get("digit"))]["label"] = flow["label"]
    remove_common_label_prefix(main_options)
    mirror = {clean_text(option.get("digit")): clean_text(option.get("label")) for option in main_options}
    for flow in option_flows:
        if clean_text(flow.get("digit")) in mirror:
            flow["label"] = mirror[clean_text(flow.get("digit"))]


def functional_menus(semantic_model: Dict[str, Any]) -> List[Dict[str, Any]]:
    menus = []
    for action in semantic_model.get("actions", []):
        if not isinstance(action, dict) or clean_text(action.get("type")).upper() != "MENU":
            continue
        text = action_search_text(action)
        variable = menu_variable(action.get("parameters")).upper()
        has_dtmf = bool(action.get("cases")) or variable in {"MRES", "MRES1", "MRES2", "MRES3", "MRESF", "OP_ESCOLHIDA", "OPCAO"}
        if has_dtmf and not is_collect_action(action):
            menus.append(action)
    return menus


def classify_flow_kind(semantic_model: Dict[str, Any], pre_semantic_extract: Dict[str, Any], ai_organizer: Dict[str, Any]) -> Dict[str, Any]:
    actions = [action for action in semantic_model.get("actions", []) if isinstance(action, dict)]
    menu_count = len(functional_menus(semantic_model))
    if_count = len([action for action in actions if clean_text(action.get("type")).upper() == "IF"])
    api_count = len([action for action in actions if clean_text(action.get("type")).upper() in {"RUNSUB", "REST_API"}])
    play_count = len([action for action in actions if clean_text(action.get("type")).upper() == "PLAY"])
    next_step_count = len([action for action in actions if summarize_action_output(action).get("nextStep") or "{NEXT_STEP}" in action_code(action)])
    snippet_rule_count = len([item for item in pre_semantic_extract.get("snippets", []) if (item.get("cases") or item.get("assignments"))])
    if menu_count and (if_count or api_count or play_count):
        return {"kind": "hybrid_flow", "reason": "Fluxo possui menu DTMF com regras, APIs ou audios ao redor.", "confidence": 0.86}
    if menu_count:
        return {"kind": "menu_flow", "reason": "Fluxo possui menu DTMF funcional.", "confidence": 0.9}
    if api_count >= max(2, if_count) and not menu_count:
        return {"kind": "api_flow", "reason": "Fluxo sem menu, predominante em APIs/integracoes.", "confidence": 0.82}
    if if_count or play_count or next_step_count or snippet_rule_count:
        return {"kind": "rule_flow", "reason": "Fluxo sem menu, documentado por regras, IFs, PLAYs, APIs e NEXT_STEP.", "confidence": 0.88}
    return {"kind": "rule_flow", "reason": "Fluxo sem menu DTMF identificado.", "confidence": 0.55}


def resolve_composed_audio_variable(variable_name: Any, trace_context: Dict[str, str], semantic_model: Dict[str, Any], until_action_id: str = "") -> Dict[str, Any]:
    variable = clean_text(variable_name).strip("{}")
    if not variable:
        return {"variable": "", "audioType": "", "candidates": [], "dynamicParts": []}
    actions_map = action_by_id(semantic_model)
    order, _levels = navigation_order(semantic_model)
    if until_action_id in order:
        order = order[: order.index(until_action_id) + 1]
    code = "\n".join(action_code(actions_map[aid]) for aid in order if aid in actions_map)
    candidates: List[str] = []
    dynamic_parts: List[str] = []
    for match in WAV_RE.finditer(code):
        file_name = re.split(r"[\\/]", match.group("path"))[-1].strip(" '\"")
        if file_name and not is_auxiliary_audio_file(file_name) and file_name not in candidates:
            candidates.append(file_name)
    variable_lines = [line for line in code.splitlines() if variable.lower() in line.lower()]
    for line in variable_lines:
        low = line.lower()
        if any(token in low for token in ["data", "venc", "due"]):
            dynamic_parts.append("data de vencimento")
        if any(token in low for token in ["valor", "saldo", "fatura"]):
            dynamic_parts.append("valor da fatura/saldo")
        if any(token in low for token in ["mes", "mês"]):
            dynamic_parts.append("mes de referencia")
    return {
        "variable": variable,
        "audioType": "composed" if candidates or dynamic_parts else "variable",
        "candidates": candidates[:10],
        "dynamicParts": list(dict.fromkeys(dynamic_parts))[:6],
    }


def is_auxiliary_audio_file(file_name: Any) -> bool:
    name = clean_text(file_name).lower()
    if not name:
        return True
    base = re.sub(r"\.wav$", "", re.split(r"[\\/]", name)[-1], flags=re.IGNORECASE)
    if base.endswith("_nf") or base in {"nf", "vazio", "silencio"}:
        return True
    return bool(re.search(r"^(mes|dia|ano|valor|centavo|reais?|numero|digito|data)_?\w*$", base))


def rule_action_label(action: Dict[str, Any], semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any], trace_context: Dict[str, str]) -> str:
    atype = clean_text(action.get("type")).upper()
    output = summarize_action_output(action)
    text = action_search_text(action)
    if atype == "BEGIN":
        return "Inicio"
    if atype in {"RUNSUB", "REST_API"}:
        service = clean_text(action.get("caption") or output.get("nextStep") or atype)
        return f"Consulta {clean_option_label_token(service) or 'API'}"
    if atype == "PLAY":
        audio = audio_context_for_action(action, semantic_model)
        if clean_text(audio.get("fileName")).strip("{}").lower() in {"noteplay", "audio", "notemenu"} or "noteplay" in text:
            return "Executa audio dinamico"
        play = humanize_play_node(action, semantic_model, ai_organizer)
        return clean_text(play.get("displayLabel")) or "Executa audio"
    if atype == "IF":
        label, _condition = humanize_if_short(action, ai_organizer)
        return clean_display_text(label) or "Avalia regra"
    if atype == "RUNSCRIPT":
        target = output.get("nextStep") or clean_text(trace_context.get("NEXT_STEP")) or clean_text(action.get("caption"))
        return "Executa proximo fluxo" if target else "Direciona para proximo fluxo"
    if atype == "SNIPPET":
        if output.get("nextStep"):
            return "Define proximo fluxo"
        audios = iter_action_audio_paths(action)
        if audios or "noteplay" in text or "concat" in text:
            return "Monta audio dinamico"
        if parse_switch_case_tree(action_code(action)):
            return "Aplica regras de negocio"
        if is_technical_noise_action(action):
            return ""
        return clean_option_label_token(action.get("caption")) or "Prepara variaveis"
    return clean_option_label_token(action.get("caption")) or friendly_action_label(action, ai_organizer)


def business_step_from_action(action: Dict[str, Any], semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any], trace_context: Dict[str, str]) -> Optional[Dict[str, Any]]:
    aid = clean_text(action.get("actionId"))
    atype = clean_text(action.get("type")).upper()
    output = summarize_action_output(action)
    if output:
        update_trace_context_from_assignments(trace_context, {key: value for key, value in output.items() if clean_text(value)})
    assignments = parse_assignments(action_code(action))
    if assignments:
        update_trace_context_from_assignments(trace_context, assignments)
    label = rule_action_label(action, semantic_model, ai_organizer, trace_context)
    if not label:
        return None
    audio = audio_context_for_action(action, semantic_model)
    audio_variable = ""
    if atype == "PLAY" and not clean_text(audio.get("fileName")):
        for token in re.findall(r"\{([^}]+)\}", action_code(action)):
            if "audio" in token.lower() or "note" in token.lower():
                audio_variable = token
                break
    composed = resolve_composed_audio_variable(audio_variable, trace_context, semantic_model, aid) if audio_variable else {}
    branches = []
    if atype == "IF":
        for edge in build_navigation_maps(semantic_model)[1].get(aid, [])[:4]:
            target = build_navigation_maps(semantic_model)[0].get(clean_text(edge.get("target")))
            branches.append(
                {
                    "label": human_branch_label(edge_label_text(edge)),
                    "target": clean_option_label_token((target or {}).get("caption")) or branch_meaning(edge_label_text(edge), semantic_model, clean_text(edge.get("target"))),
                    "targetActionId": clean_text(edge.get("target")),
                }
            )
    hours_treatments = extract_hours_treatments_for_step(action, semantic_model, trace_context, ai_organizer) if atype == "HOURS" else {}
    rules = []
    for case in parse_switch_case_tree(action_code(action))[:8]:
        values = _case_range_label(case.get("caseValues") or [])
        assignments = case.get("assignments") or {}
        target = assignment_value(assignments, ["NEXT_STEP", "next_step", "SKILL_NAME", "SKILL_ID", "AUDIO", "audio"])
        if values or target:
            rules.append(short_label(" -> ".join(item for item in [values or "Default", clean_option_label_token(target) or target] if clean_text(item)), 90))
    kind = {
        "BEGIN": "start",
        "IF": "decision",
        "HOURS": "decision",
        "PLAY": "play",
        "RUNSUB": "api",
        "REST_API": "api",
        "RUNSCRIPT": "routing",
        "END": "end",
    }.get(atype, "rule" if rules else "process")
    next_step = output.get("nextStep") or clean_text(trace_context.get("NEXT_STEP"))
    if atype == "RUNSCRIPT" and "{NEXT_STEP}" in action_code(action) and next_step:
        label = "Executa proximo fluxo"
    if atype == "HOURS":
        label = hours_display_label(action)
    return {
        "nodeKey": f"rule_{aid}",
        "actionId": aid,
        "type": kind,
        "displayLabel": label,
        "summary": [],
        "rules": rules,
        "branches": branches,
        "audio": audio,
        "audioResolvedFrom": clean_text(audio.get("resolvedFrom") or audio.get("origin")),
        "contextSnapshot": context_snapshot(trace_context),
        "composedAudio": composed,
        "api": clean_text(action.get("caption")) if atype in {"RUNSUB", "REST_API"} else "",
        "nextStep": next_step,
        "hoursKey": hours_treatments.get("hoursKey"),
        "mainBranch": hours_treatments.get("mainBranch") or {},
        "sideBranches": hours_treatments.get("sideBranches") or [],
        "hideCondition": bool(hours_treatments.get("hideCondition")),
        "evidence": [f"ActionID {aid}"],
    }


def detect_decision_chain(raw_steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    chains: List[Dict[str, Any]] = []
    current: List[Dict[str, Any]] = []
    for step in raw_steps + [{"type": "_flush"}]:
        if clean_text(step.get("type")) == "decision":
            current.append(step)
            continue
        if len(current) >= 3:
            rules = []
            for item in current[:8]:
                label = clean_text(item.get("displayLabel"))
                if label and label not in rules:
                    rules.append(label)
            chains.append(
                {
                    "nodeKey": "decision_chain_" + clean_text(current[0].get("actionId")),
                    "type": "rule_group",
                    "displayLabel": "Classifica regras de negocio",
                    "rules": rules,
                    "evidence": [e for item in current for e in item.get("evidence", [])][:10],
                }
            )
        elif current:
            chains.extend(current)
        current = []
        if step.get("type") != "_flush":
            chains.append(step)
    return chains


def is_status_classification_decision(step: Dict[str, Any]) -> bool:
    text = " ".join([clean_text(step.get("displayLabel")), " ".join(step.get("rules") or [])]).upper()
    return any(token in text for token in ["SUBSTSRNCD", "SUB_STS", "STSRSN", "OFSSU", "OFFSU", "OFSUS", "HPSUS", "FUSUS", "DELINQDAYS", "STATUS_DEVEDOR"])


def group_status_decisions(steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    status_steps = [step for step in steps if clean_text(step.get("type")) == "decision" and is_status_classification_decision(step)]
    if len(status_steps) < 3:
        return steps
    first_key = clean_text(status_steps[0].get("nodeKey") or status_steps[0].get("actionId"))
    rules = []
    evidence = []
    for step in status_steps:
        label = clean_text(step.get("displayLabel"))
        if label and label not in rules:
            rules.append(label)
        evidence.extend(step.get("evidence") or [])
    grouped = {
        "nodeKey": f"status_chain_{safe_drawio_id(first_key)}",
        "type": "rule_group",
        "displayLabel": "Classifica status do devedor",
        "rules": rules[:8],
        "branches": [],
        "audio": {},
        "evidence": evidence[:12],
    }
    result: List[Dict[str, Any]] = []
    inserted = False
    skip_ids = {clean_text(step.get("nodeKey") or step.get("actionId")) for step in status_steps}
    for step in steps:
        step_key = clean_text(step.get("nodeKey") or step.get("actionId"))
        if step_key in skip_ids:
            if not inserted:
                result.append(grouped)
                inserted = True
            continue
        result.append(step)
    return result


def compact_rule_steps(raw_steps: List[Dict[str, Any]], semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any]) -> List[Dict[str, Any]]:
    compacted: List[Dict[str, Any]] = []
    seen_consecutive = ""
    for step in group_status_decisions(detect_decision_chain(raw_steps)):
        label = clean_text(step.get("displayLabel"))
        if not label:
            continue
        key = clean_text(step.get("type")) + "|" + label + "|" + clean_text(step.get("nextStep"))
        if key == seen_consecutive:
            continue
        seen_consecutive = key
        compacted.append(step)
        if len(compacted) >= 24:
            break
    return compacted


def trace_business_graph(semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any]) -> List[Dict[str, Any]]:
    actions_map = action_by_id(semantic_model)
    order, _levels = navigation_order(semantic_model)
    begin = next((action for action in semantic_model.get("actions", []) if clean_text(action.get("type")).upper() == "BEGIN"), None)
    if begin and clean_text(begin.get("actionId")) in order:
        start_index = order.index(clean_text(begin.get("actionId")))
        order = order[start_index:]
    raw_steps: List[Dict[str, Any]] = []
    trace_context: Dict[str, str] = {
        "NEXT_STEP": "",
        "scriptpoint": "",
        "MAPA_DNA": "",
        "TIPO_STATUS_DEVEDOR": "",
        "REDUCAO_ON": "",
        "CHAVE_REDUCAO": "",
    }
    for aid in order[:120]:
        action = actions_map.get(aid)
        if not action:
            continue
        atype = clean_text(action.get("type")).upper()
        if atype in {"ONANSWER", "ONRELEASE"}:
            continue
        step = business_step_from_action(action, semantic_model, ai_organizer, trace_context)
        if step:
            raw_steps.append(step)
    return raw_steps


def build_rule_flow_story(raw_actions: Dict[str, Any], semantic_model: Dict[str, Any], pre_semantic_extract: Dict[str, Any], ai_organizer: Dict[str, Any], flow_kind: Dict[str, Any]) -> Dict[str, Any]:
    raw_steps = trace_business_graph(semantic_model, ai_organizer)
    business_story = compact_rule_steps(raw_steps, semantic_model, ai_organizer)
    api_story = [step for step in business_story if step.get("type") == "api"]
    audio_story = [step for step in business_story if step.get("type") == "play" or (step.get("composedAudio") or {}).get("candidates")]
    side_events = []
    for item in pre_semantic_extract.get("cdrScriptpoints", [])[:8]:
        side_events.append({"label": "Registro CDR", "actionId": clean_text(item.get("sourceActionId")), "type": "CDR"})
    return {
        "flowKind": flow_kind,
        "businessStory": business_story,
        "decisionTree": [step for step in business_story if step.get("type") in {"decision", "rule_group"}],
        "menuStory": None,
        "mainMenu": None,
        "optionFlows": [],
        "apiStory": api_story,
        "audioStory": audio_story,
        "sideEvents": side_events,
        "endings": [step for step in business_story if step.get("type") in {"end", "routing"}],
    }


def build_navigation_story(raw_actions: Dict[str, Any], pre_semantic_extract: Dict[str, Any], ai_organizer: Dict[str, Any], human_routes: Dict[str, Any], semantic_model: Dict[str, Any]) -> Dict[str, Any]:
    flow_kind = classify_flow_kind(semantic_model, pre_semantic_extract, ai_organizer)
    if flow_kind.get("kind") in {"rule_flow", "api_flow"}:
        return build_rule_flow_story(raw_actions, semantic_model, pre_semantic_extract, ai_organizer, flow_kind)
    main_menu = find_main_menu_for_story(semantic_model, ai_organizer)
    dispatcher = find_menu_dispatcher(clean_text((main_menu or {}).get("actionId")), semantic_model) if main_menu else {}
    main_options = extract_real_menu_options(main_menu, semantic_model, ai_organizer)
    has_execution_model = isinstance(semantic_model.get("executionModel"), dict) and bool(semantic_model.get("executionModel"))
    if not main_options and not has_execution_model:
        main_options = menu_options_for_story(main_menu, ai_organizer)
    if not main_options and not has_execution_model:
        main_options = fallback_main_options_from_routes(human_routes, main_menu)
    main_options = refine_main_menu_options(main_options, main_menu, semantic_model, ai_organizer)
    main_audio = audio_context_for_action(main_menu, semantic_model)
    main_id = clean_text((main_menu or {}).get("actionId"))
    side_events = []
    for item in pre_semantic_extract.get("integrations", []):
        if clean_text(item.get("type")).upper() in {"ONANSWER", "ONRELEASE"} or any(token in " ".join(clean_text(item.get(k)).lower() for k in ["caption", "nextStep", "transferCode"]) for token in ["desliga", "cdr", "release"]):
            side_events.append({"label": short_label(clean_text(item.get("caption") or item.get("type")), 70), "actionId": clean_text(item.get("actionId")), "type": clean_text(item.get("type"))})
    for item in pre_semantic_extract.get("cdrScriptpoints", [])[:8]:
        side_events.append({"label": "Registro CDR", "actionId": clean_text(item.get("sourceActionId")), "type": "CDR"})
    option_flows = [
        trace_option_flow(option, main_menu, dispatcher, semantic_model, ai_organizer)
        for option in main_options
    ]
    refine_option_flow_labels(option_flows, main_options)
    return {
        "flowKind": flow_kind,
        "businessStory": [],
        "decisionTree": [],
        "menuStory": "mainMenu",
        "apiStory": [],
        "audioStory": [],
        "preMenu": trace_pre_menu_path(semantic_model, main_id, ai_organizer),
        "mainMenu": {
            "actionId": main_id,
            "label": friendly_action_label(main_menu or {}, ai_organizer) if main_menu else "Menu principal",
            "displayLabel": friendly_action_label(main_menu or {}, ai_organizer) if main_menu else "Menu principal",
            "technicalLabel": f"MENU ActionID {main_id}" if main_id else "",
            "captureVariable": menu_variable((main_menu or {}).get("parameters")),
            "audio": main_audio,
            "options": main_options,
            "dispatcher": {
                "actionId": clean_text(dispatcher.get("actionId")),
                "path": dispatcher.get("path") or [],
                "maskOptions": dispatcher.get("maskOptions") or [],
            },
        },
        "optionFlows": option_flows,
        "subFlows": [
            build_subflow_tree_for_main_option(option, semantic_model, human_routes, ai_organizer)
            for option in main_options
        ],
        "loops": extract_loop_treatments_for_menu(main_menu, semantic_model) if main_menu else [],
        "sideEvents": side_events[:10],
        "endings": [],
    }


def visual_block_type(step_type: Any) -> str:
    kind = clean_text(step_type).lower()
    if kind in {"start", "begin"}:
        return "start"
    if kind in {"decision", "if", "hours", "case", "rule_group", "menu"}:
        return "menu" if kind == "menu" else "decision" if kind != "rule_group" else "rule_group"
    if kind in {"api", "runsub", "rest_api"}:
        return "api"
    if kind in {"play"}:
        return "play"
    if kind in {"routing", "runscript", "reqagent", "transfer"}:
        return "routing" if kind in {"routing", "runscript"} else "transfer"
    if kind in {"end", "terminal"}:
        return "end"
    if kind in {"loop"}:
        return "loop"
    return "process"


def build_visual_block_from_step(step: Dict[str, Any], semantic_model: Dict[str, Any], trace_context: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    context = trace_context or step.get("context") or {}
    aid = clean_text(step.get("actionId"))
    block = {
        "nodeKey": clean_text(step.get("nodeKey")) or f"visual_{safe_drawio_id(aid or step.get('displayLabel'))}",
        "type": visual_block_type(step.get("type")),
        "label": clean_display_text(step.get("displayLabel") or step.get("label")),
        "subtitle": clean_display_text(step.get("secondaryLabel") or step.get("conditionLabel") or step.get("api") or step.get("nextStep")),
        "audio": step.get("audio") if isinstance(step.get("audio"), dict) else {},
        "rules": [clean_text(item) for item in step.get("rules") or [] if clean_text(item)],
        "branches": [],
        "children": [],
        "evidence": step.get("evidence") or ([f"ActionID {aid}"] if aid else []),
        "technicalActionIds": [aid] if aid else [],
        "actionId": aid,
        "nextStep": clean_text(step.get("nextStep") or step.get("resolvedTarget")),
        "context": dict(context),
        "contextSnapshot": step.get("contextSnapshot") or context_snapshot(context),
        "audioResolvedFrom": clean_text(step.get("audioResolvedFrom")),
        "composedAudio": step.get("composedAudio") or {},
        "hideCondition": bool(step.get("hideCondition")),
        "technicalCondition": clean_text(step.get("technicalCondition")),
        "hoursKey": step.get("hoursKey"),
        "mainBranch": step.get("mainBranch") or {},
        "sideBranches": step.get("sideBranches") or [],
    }
    block["audio"] = resolve_audio_for_visual_block(block, context, semantic_model)
    block["audioResolvedFrom"] = clean_text(block.get("audioResolvedFrom") or (block.get("audio") or {}).get("resolvedFrom") or (block.get("audio") or {}).get("origin"))
    if not block["label"]:
        block["label"] = clean_option_label_token(block.get("nextStep")) or clean_text(block.get("type")).title()
    return block


def trace_branch_tree(start_action_id: Any, semantic_model: Dict[str, Any], context: Dict[str, str], ai_organizer: Dict[str, Any], max_depth: int = 12) -> List[Dict[str, Any]]:
    actions_map, adjacency, _incoming = build_navigation_maps(semantic_model)
    current_id = clean_text(start_action_id)
    local_context = dict(context or {})
    visited: set = set()
    blocks: List[Dict[str, Any]] = []
    depth = 0
    while current_id and current_id in actions_map and depth < max_depth:
        if current_id in visited:
            blocks.append(
                {
                    "nodeKey": f"loop_{safe_drawio_id(current_id)}",
                    "type": "loop",
                    "label": "Retorno para ponto visitado",
                    "subtitle": f"ActionID {current_id}",
                    "audio": {},
                    "rules": [],
                    "branches": [],
                    "children": [],
                    "evidence": [f"ActionID {current_id}"],
                    "technicalActionIds": [current_id],
                    "actionId": current_id,
                    "context": dict(local_context),
                }
            )
            break
        visited.add(current_id)
        action = actions_map[current_id]
        step = business_step_from_action(action, semantic_model, ai_organizer, local_context)
        if step:
            block = build_visual_block_from_step(step, semantic_model, local_context)
            if block.get("type") == "decision":
                if block.get("sideBranches"):
                    block["branches"] = []
                else:
                    block["branches"] = build_visual_branches_for_decision(block, semantic_model, local_context, ai_organizer, max_depth=max(3, max_depth - depth - 1), nested=True)
                blocks.append(block)
                break
            blocks.append(block)
        atype = clean_text(action.get("type")).upper()
        if atype in {"END", "REQAGENT"}:
            break
        outgoing = adjacency.get(current_id, [])
        main_edge = choose_main_navigation_edge(action, outgoing, local_context, clean_text(local_context.get("MRES") or local_context.get("MRES1")))
        if not main_edge:
            break
        current_id = clean_text(main_edge.get("target"))
        depth += 1
    return blocks


def build_visual_branches_for_decision(block: Dict[str, Any], semantic_model: Dict[str, Any], context: Dict[str, str], ai_organizer: Dict[str, Any], max_depth: int = 8, nested: bool = False) -> List[Dict[str, Any]]:
    aid = clean_text(block.get("actionId"))
    if not aid:
        return []
    actions_map, adjacency, _incoming = build_navigation_maps(semantic_model)
    action = actions_map.get(aid)
    if is_hours_action(action):
        return (extract_hours_treatments_for_step(action or {"actionId": aid}, semantic_model, context, ai_organizer).get("sideBranches") or [])
    branches: List[Dict[str, Any]] = []
    for edge in adjacency.get(aid, [])[:4]:
        target_id = clean_text(edge.get("target"))
        if not target_id:
            continue
        target_action = actions_map.get(target_id)
        target_label = clean_option_label_token((target_action or {}).get("caption")) or branch_meaning(edge_label_text(edge), semantic_model, target_id)
        children = [] if nested else trace_branch_tree(target_id, semantic_model, dict(context), ai_organizer, max_depth=max_depth)
        branches.append(
            {
                "label": human_branch_label(edge_label_text(edge)),
                "target": target_label,
                "targetActionId": target_id,
                "children": children,
                "evidence": [f"ActionID {aid} -> {target_id}"],
            }
        )
    return branches


def build_visual_blocks(navigation_story: Dict[str, Any], semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any]) -> Dict[str, Any]:
    flow_kind = clean_text((navigation_story.get("flowKind") or {}).get("kind")) or "menu_flow"
    result: Dict[str, Any] = {"flowKind": flow_kind, "blocks": []}
    if flow_kind in {"rule_flow", "api_flow"}:
        blocks = []
        for step in navigation_story.get("businessStory") or []:
            if not isinstance(step, dict):
                continue
            block = build_visual_block_from_step(step, semantic_model, step.get("context") or {})
            if block.get("type") == "decision" and not block.get("sideBranches"):
                block["branches"] = build_visual_branches_for_decision(block, semantic_model, block.get("context") or {}, ai_organizer)
            blocks.append(block)
        result["blocks"] = blocks
        return result

    pre_blocks = [
        build_visual_block_from_step(item, semantic_model, item.get("context") or {})
        for item in navigation_story.get("preMenu") or []
        if isinstance(item, dict)
    ]
    main_menu = navigation_story.get("mainMenu") or {}
    menu_block = build_visual_block_from_step(
        {
            "nodeKey": "main_menu",
            "type": "menu",
            "actionId": main_menu.get("actionId"),
            "displayLabel": main_menu.get("displayLabel") or main_menu.get("label") or "Menu principal",
            "audio": main_menu.get("audio") or {},
            "evidence": [f"ActionID {main_menu.get('actionId')}"] if clean_text(main_menu.get("actionId")) else [],
        },
        semantic_model,
        {},
    )
    menu_block["options"] = main_menu.get("options") or []
    route_blocks = []
    for flow_item in navigation_story.get("optionFlows") or []:
        if not isinstance(flow_item, dict):
            continue
        children = [
            build_visual_block_from_step(step, semantic_model, step.get("context") or flow_item.get("variablesContext") or {})
            for step in (flow_item.get("visibleSteps") or flow_item.get("steps") or [])[:18]
            if isinstance(step, dict)
        ]
        route_blocks.append(
            {
                "nodeKey": f"route_{safe_drawio_id(flow_item.get('digit'))}_{len(route_blocks)}",
                "type": "route",
                "label": clean_display_text(flow_item.get("label") or f"Opcao {flow_item.get('digit')}"),
                "subtitle": clean_text(flow_item.get("digit")),
                "audio": {},
                "rules": [],
                "branches": [],
                "children": children,
                "evidence": flow_item.get("evidence") or [],
                "technicalActionIds": [clean_text(flow_item.get("targetActionId"))] if clean_text(flow_item.get("targetActionId")) else [],
                "terminal": flow_item.get("terminal") or {},
                "sideTreatments": flow_item.get("sideTreatments") or [],
            }
        )
    result["preBlocks"] = pre_blocks
    result["menuBlock"] = menu_block
    result["routeBlocks"] = route_blocks
    result["blocks"] = [*pre_blocks, menu_block, *route_blocks]
    return result


def build_semantic_routes(semantic_model: Dict[str, Any]) -> Dict[str, Any]:
    flow = semantic_model
    rows = semantic_rows(flow)
    routes = []
    seen = set()
    for index, row in enumerate(rows, start=1):
        if row.get("kind") == "prompt":
            continue
        path = [clean_text(item) for item in row.get("caseValues") or [] if clean_text(item)]
        if not path:
            path = [str(index)]
        subject = clean_text(row.get("treatment") or row.get("category") or row.get("skillName") or row.get("nextStep") or row.get("audio") or "Rota")
        key = (">".join(path), clean_text(row.get("sourceActionId")), subject, clean_text(row.get("skillId")), clean_text(row.get("nextStep")))
        if key in seen:
            continue
        seen.add(key)
        target_type = "skill" if row.get("skillId") or row.get("skillName") else "next_step" if row.get("nextStep") else "action"
        routes.append(
            {
                "routeId": f"R{len(routes) + 1:03d}",
                "path": path,
                "pathLabel": " > ".join([*path, subject]) if path else subject,
                "originMenuActionId": clean_text(row.get("sourceActionId")),
                "actions": [clean_text(row.get("sourceActionId"))] if clean_text(row.get("sourceActionId")) else [],
                "group": clean_text(row.get("category") or "Jornada"),
                "domain": clean_text(row.get("category")),
                "treatment": subject,
                "prompts": [
                    prompt
                    for prompt in flow.get("prompts", [])
                    if clean_text(prompt.get("sourceActionId")) == clean_text(row.get("sourceActionId"))
                ],
                "target": {
                    "type": target_type,
                    "skillId": clean_text(row.get("skillId")),
                    "skillName": clean_text(row.get("skillName")),
                    "actionId": clean_text(row.get("target")),
                },
                "nextStep": clean_text(row.get("nextStep")),
                "scriptpoint": clean_text(row.get("scriptpoint")),
                "mapaDna": clean_text(row.get("mapaDna")),
                "transferCode": clean_text(row.get("transferCode")),
                "confidence": clean_text(row.get("confidence") or "deterministic"),
                "evidence": [f"ActionID {row.get('sourceActionId')}", f"CASE {'/'.join(path)}"],
            }
        )
    if not routes:
        for index, action in enumerate(flow.get("actions", [])[:40], start=1):
            if clean_text(action.get("nextStep")) or action.get("skills") or clean_text(action.get("type")).upper() in {"RUNSCRIPT", "RUNSUB", "REST_API", "REQAGENT"}:
                routes.append(
                    {
                        "routeId": f"R{len(routes) + 1:03d}",
                        "path": [str(index)],
                        "pathLabel": clean_text(action.get("businessLabel") or action.get("caption") or action.get("type")),
                        "originMenuActionId": clean_text(action.get("actionId")),
                        "actions": [clean_text(action.get("actionId"))],
                        "group": clean_text(action.get("group") or "Fluxo tecnico"),
                        "domain": clean_text(action.get("category")),
                        "treatment": clean_text(action.get("businessLabel") or action.get("caption")),
                        "prompts": action.get("prompts") or [],
                        "target": {"type": clean_text(action.get("type")).lower()},
                        "nextStep": clean_text(action.get("nextStep")),
                        "scriptpoint": clean_text(action.get("scriptpoint")),
                        "mapaDna": clean_text(action.get("mapaDna")),
                        "transferCode": clean_text(action.get("transferCode")),
                        "confidence": "deterministic",
                        "evidence": [f"ActionID {action.get('actionId')}"],
                    }
                )
    return {"routes": routes}


NAVIGATION_PATH_VARS = ["MRES", "MRES1", "MRES2", "MRES3"]
NAVIGATION_COMPOSED_VARS = ["MRESF1", "mresf1", "MRESF", "mresf"]


def context_lookup_any(context: Dict[str, Any], key: str) -> str:
    return clean_text(context.get(key) or context.get(key.upper()) or context.get(key.lower()))


def split_digit_path(value: Any) -> List[str]:
    text = re.sub(r"\D+", "", clean_text(value))
    return list(text) if text else []


def explicit_path_from_context(context: Dict[str, Any]) -> List[str]:
    for key in NAVIGATION_COMPOSED_VARS:
        value = context_lookup_any(context, key)
        if value and re.fullmatch(r"\d{2,}", value):
            return split_digit_path(value)
    path = []
    for key in NAVIGATION_PATH_VARS:
        value = context_lookup_any(context, key)
        if value:
            path.extend(split_digit_path(value))
    return path


def is_grouped_case_value(value: Any) -> bool:
    return bool(re.search(r"[,;-]", clean_text(value)))


def compact_case_group_path(case_group: Any, fallback_path: List[str]) -> List[str]:
    text = clean_text(case_group)
    range_match = re.fullmatch(r"(\d+)\s*-\s*(\d+)", text)
    if range_match:
        start, end = range_match.group(1), range_match.group(2)
        if len(start) == len(end) and len(start) > 1 and start[:-1] == end[:-1]:
            return [*list(start[:-1]), f"CASE {start[-1]}-{end[-1]}"]
        return [*fallback_path, f"CASE {text}"]
    if "," in text:
        return [*fallback_path, f"CASE {text}"]
    return [*fallback_path, text] if text else fallback_path


def path_for_menu_option(context: Dict[str, Any], option: Dict[str, Any], capture_variable: Any = "") -> Tuple[List[str], str]:
    base_path = explicit_path_from_context(context)
    digit = clean_text(option.get("digit"))
    case_group = clean_text((option.get("case") or {}).get("value") or (option.get("case") or {}).get("name") or digit)
    capture = clean_text(capture_variable).upper()
    if is_grouped_case_value(case_group):
        return compact_case_group_path(case_group, base_path), case_group
    if digit and len(re.sub(r"\D", "", digit)) > 1:
        return split_digit_path(digit), case_group
    if capture in {"MRES", "MRES1", "MRES2", "MRES3"} and digit and context_lookup_any(context, capture) != digit:
        return [*base_path, digit], case_group
    if digit and (not base_path or base_path[-1:] != [digit]):
        return [*base_path, digit], case_group
    return base_path, case_group


def path_display(path: List[str]) -> str:
    return " > ".join(clean_text(item) for item in path if clean_text(item)) or "-"


def case_group_display(case_group: Any, option: Dict[str, Any]) -> str:
    text = clean_text(case_group)
    if not text:
        return ""
    if is_grouped_case_value(text) or len(re.sub(r"\D", "", text)) > 1:
        return text
    source = clean_text(option.get("source"))
    return f"CASE {text}" if "CASE" in source.upper() else text


def prompt_text_for_action(action: Optional[Dict[str, Any]], semantic_model: Dict[str, Any], context: Dict[str, Any]) -> str:
    if not action:
        return ""
    audio = dynamic_menu_audio_for_action(action, semantic_model, clean_text(action.get("actionId")), context)
    if not clean_text(audio.get("fileName")) and clean_text(audio.get("mode")) != "dynamic":
        audio = resolve_audio_for_visual_block({"actionId": clean_text(action.get("actionId")), "audio": {}}, context, semantic_model)
    audio_line = render_audio_line(audio)
    return audio_line or action_audio_text(action, prompt_index_by_action(semantic_model), 180)


def infer_destination_for_menu_row(option: Dict[str, Any], actions_map: Dict[str, Dict[str, Any]]) -> Tuple[str, str]:
    option_context = option.get("executionContext") if isinstance(option.get("executionContext"), dict) else {}
    skill_id = clean_text(option.get("skillId") or context_lookup_any(option_context, "SKILL_ID"))
    skill_name = clean_text(option.get("skillName") or context_lookup_any(option_context, "SKILL_NAME"))
    if skill_id or skill_name:
        return skill_name or skill_id, "skill"
    next_step = clean_text(option.get("nextStep") or context_lookup_any(option_context, "NEXT_STEP"))
    if next_step:
        return next_step, "next_step"
    transfer_code = clean_text(option.get("transferCode") or context_lookup_any(option_context, "TRANSFERCODE") or context_lookup_any(option_context, "TransferCode"))
    if transfer_code:
        return transfer_code, "transfer_code"
    target = clean_text(option.get("targetActionId"))
    target_action = actions_map.get(target)
    if target_action:
        return clean_text(target_action.get("businessLabel") or target_action.get("caption") or target_action.get("type") or target), clean_text(target_action.get("type")).lower() or "action"
    return target, "action" if target else ""


def menu_row_label(path: List[str], option: Dict[str, Any]) -> str:
    label = clean_text(option.get("label"))
    if label and not is_bad_option_label(label):
        return label
    next_step = clean_text(option.get("nextStep"))
    if next_step:
        return clean_option_label_token(next_step) or next_step
    audio = clean_text(option.get("audio"))
    if audio:
        return audio_subject_from_path(audio) or f"Opcao {(path or [''])[-1]}"
    return f"Opcao {(path or [''])[-1]}" if path else "Opcao"


def build_menu_map_rows_v2(execution_model: Dict[str, Any], semantic_model: Dict[str, Any], navigation_story: Dict[str, Any], ai_organizer: Dict[str, Any]) -> List[Dict[str, Any]]:
    actions_map = action_by_id(semantic_model)
    menus = execution_model.get("menus") or {}
    rows: List[Dict[str, Any]] = []
    seen = set()

    def add_row(menu_id: str, option: Dict[str, Any], context: Dict[str, Any], evidence_prefix: str = "") -> None:
        if not menu_id:
            return
        menu_meta = menus.get(menu_id) or {}
        menu_action = actions_map.get(menu_id) or execution_model.get("actionsById", {}).get(menu_id)
        capture_var = clean_text(menu_meta.get("captureVariable") or menu_variable((menu_action or {}).get("parameters")))
        path, case_group = path_for_menu_option(context, option, capture_var)
        digit = clean_text(option.get("digit"))
        if evidence_prefix.startswith("Trilha") and menu_id != main_id and digit and len(digit) == 1 and len(path) == 1 and path[-1:] == [digit]:
            path = [*path, digit]
        path_text = path_display(path)
        case_text = case_group_display(case_group, option)
        destination, destination_type = infer_destination_for_menu_row(option, actions_map)
        option_context = option.get("executionContext") if isinstance(option.get("executionContext"), dict) else {}
        skill_id = clean_text(option.get("skillId") or context_lookup_any(option_context, "SKILL_ID"))
        skill_name = clean_text(option.get("skillName") or context_lookup_any(option_context, "SKILL_NAME"))
        key = (path_text, case_text, skill_id, skill_name, menu_id, clean_text(option.get("digit")), destination)
        if key in seen:
            return
        seen.add(key)
        evidence_items = [evidence_prefix, *[clean_text(item) for item in option.get("evidence") or []], f"Menu ActionID {menu_id}"]
        rows.append(
            {
                "pathDisplay": path_text,
                "path": path,
                "level": len([item for item in path if not clean_text(item).upper().startswith("CASE")]),
                "group": clean_text(menu_meta.get("caption") or (menu_action or {}).get("businessLabel") or (menu_action or {}).get("caption") or "Menu"),
                "label": menu_row_label(path, option),
                "menuActionId": menu_id,
                "captureVariable": capture_var,
                "option": clean_text(option.get("digit")),
                "promptSpeech": prompt_text_for_action(menu_action, semantic_model, context),
                "destination": destination,
                "destinationType": destination_type,
                "caseGroup": case_text,
                "evidence": "; ".join(item for item in evidence_items if clean_text(item)),
                "skillId": skill_id,
                "skillName": skill_name,
            }
        )

    main_menu = navigation_story.get("mainMenu") or {}
    main_id = clean_text(main_menu.get("actionId"))
    for option in main_menu.get("options") or []:
        context = option.get("executionContext") if isinstance(option.get("executionContext"), dict) else {}
        add_row(main_id, option, context, "Fluxo principal")

    for flow_item in navigation_story.get("optionFlows") or []:
        flow_context = flow_item.get("variablesContext") if isinstance(flow_item.get("variablesContext"), dict) else {}
        for step in flow_item.get("rawSteps") or flow_item.get("steps") or []:
            if not isinstance(step, dict):
                continue
            action_id = clean_text(step.get("actionId"))
            if action_id not in menus:
                continue
            step_context = step.get("context") if isinstance(step.get("context"), dict) else flow_context
            for option in (menus.get(action_id) or {}).get("options") or []:
                add_row(action_id, option, step_context, f"Trilha {flow_item.get('digit')}")

    for menu_id, menu_meta in menus.items():
        if any(row.get("menuActionId") == menu_id for row in rows):
            continue
        for option in menu_meta.get("options") or []:
            context = option.get("executionContext") if isinstance(option.get("executionContext"), dict) else {}
            add_row(menu_id, option, context, "Menu detectado")

    rows.sort(key=lambda row: (row.get("pathDisplay") or "", row.get("menuActionId") or "", row.get("caseGroup") or ""))
    return rows


def build_skill_map_rows_v2(menu_map_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    seen = set()
    for row in menu_map_rows:
        skill_id = clean_text(row.get("skillId"))
        skill_name = clean_text(row.get("skillName"))
        if not skill_id and not skill_name:
            continue
        key = (
            clean_text(row.get("pathDisplay")),
            clean_text(row.get("label")),
            clean_text(row.get("caseGroup")),
            skill_id,
            skill_name,
            clean_text(row.get("menuActionId")),
        )
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "pathDisplay": row.get("pathDisplay"),
                "subject": row.get("label"),
                "group": row.get("group"),
                "caseGroup": row.get("caseGroup"),
                "skillId": skill_id,
                "skillName": skill_name,
                "menuActionId": row.get("menuActionId"),
                "evidence": row.get("evidence"),
            }
        )
    return rows


MAP_GROUP_STOPWORDS = {
    "ura",
    "ivr",
    "prod",
    "dev",
    "hml",
    "homolog",
    "homologacao",
    "menu",
    "menus",
    "principal",
    "inicial",
    "saudacao",
    "saudação",
    "prompt",
    "prompts",
    "audio",
    "wav",
    "skill",
    "default",
    "action",
    "fluxo",
    "tecnico",
    "script",
    "scriptpoint",
    "snippet",
    "parametros",
    "parameter",
    "parameters",
    "entrada",
    "saida",
    "varia",
    "conforme",
    "opcao",
    "opcoes",
    "escolhida",
    "possiveis",
    "nesta",
    "neste",
    "esse",
    "essa",
    "este",
    "esta",
    "trilha",
}


def meaningful_identifier_tokens(value: Any, semantic_model: Dict[str, Any]) -> List[str]:
    words = identifier_words(value)
    project_tokens = project_identifier_words(semantic_model)
    return [
        word
        for word in words
        if word
        and len(word) > 2
        and word not in MAP_GROUP_STOPWORDS
        and word not in project_tokens
        and not word.isdigit()
        and not re.fullmatch(r"(?:audio|prompt|menu|mres|notemenu|notaudio|var|case|default|snippet)\d*", word, re.IGNORECASE)
    ]


def humanize_identifier_token(token: Any, source: Any = "") -> str:
    text = clean_text(token)
    if not text:
        return ""
    original_lookup = {item.lower(): item for item in identifier_original_words(source or text)}
    original = original_lookup.get(text.lower(), text)
    if original.isupper() and 1 < len(original) <= 8:
        return original
    return clean_option_label_token(normalize_human_text(text))


def infer_map_group(row: Dict[str, Any], semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any]) -> str:
    for value in [row.get("skillName"), row.get("group"), row.get("destination"), row.get("promptSpeech"), row.get("evidence"), row.get("pathDisplay")]:
        tokens = meaningful_identifier_tokens(value, semantic_model)
        if tokens:
            label = humanize_identifier_token(tokens[0], value)
            if label:
                return label
    menu_id = clean_text(row.get("menuActionId"))
    menu_action = action_by_id(semantic_model).get(menu_id) if menu_id else None
    if menu_action:
        for value in [menu_action.get("caption"), *iter_action_audio_paths(menu_action)]:
            tokens = meaningful_identifier_tokens(value, semantic_model)
            if tokens:
                label = humanize_identifier_token(tokens[0], value)
                if label:
                    return label
    return f"Grupo {menu_id}" if menu_id else "Grupo"


def infer_menu_category(row: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> str:
    for value in [row.get("label"), row.get("skillName"), row.get("promptSpeech"), row.get("destination")]:
        if not clean_text(value):
            continue
        if value == row.get("skillName"):
            label = subject_from_skill_name(value)
        elif clean_text(value).lower().endswith(".wav") or ".wav" in clean_text(value).lower():
            label = audio_subject_from_path(value)
        else:
            label = clean_option_label_token(value)
        if label and not label.isdigit() and not is_bad_option_label(label) and not is_generic_technical_label(label):
            return category_for_subject(label)
    option = clean_text(row.get("option"))
    return f"Opcao {option}" if option else "Categoria"


def summarize_menu_treatment(group: Dict[str, Any], category_rows: List[Dict[str, Any]]) -> str:
    if not category_rows:
        return "Agrupa opcoes relacionadas ao assunto."
    skill_names = sorted({clean_text(row.get("skillName")) for row in category_rows if clean_text(row.get("skillName"))})
    destination_types = {clean_text(row.get("destinationType")) for row in category_rows if clean_text(row.get("destinationType"))}
    destinations = sorted({clean_text(row.get("destination")) for row in category_rows if clean_text(row.get("destination"))})
    levels = [int(row.get("level") or 0) for row in category_rows if str(row.get("level") or "").isdigit()]
    if len(skill_names) == 1 and len(category_rows) == 1:
        return f"Transfere direto para {skill_names[0]}."
    if len(skill_names) == 1:
        return f"Opcoes relacionadas transferem para {skill_names[0]}."
    if "skill" in destination_types and skill_names:
        return "Algumas opcoes transferem direto; outras abrem submenu."
    if any(level > 1 for level in levels) or len(category_rows) > 1:
        return "Abre submenu para detalhar o assunto antes da transferencia."
    if destinations:
        return f"Direciona para {short_label(destinations[0], 80)}."
    return "Agrupa opcoes relacionadas ao assunto."


def dtmf_for_grouped_rows(rows: List[Dict[str, Any]]) -> str:
    values = []
    for row in rows:
        value = ""
        if isinstance(row.get("path"), list) and row.get("path"):
            value = clean_text(row.get("path")[-1])
        if not value:
            value = clean_text(row.get("option"))
        if not value:
            value = clean_text(row.get("pathDisplay"))
        if value and value not in values:
            values.append(value)
    return ", ".join(values[:8]) if values else "-"


def build_menu_map_groups(menu_map_rows: List[Dict[str, Any]], semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any]) -> Dict[str, Any]:
    groups_by_name: Dict[str, Dict[str, Any]] = {}
    buckets: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    for row in menu_map_rows:
        group_name = infer_map_group(row, semantic_model, ai_organizer)
        category = infer_menu_category(row)
        groups_by_name.setdefault(
            group_name,
            {
                "groupName": group_name,
                "source": clean_text(row.get("group")),
                "menuActionId": clean_text(row.get("menuActionId")),
                "prompt": clean_text(row.get("promptSpeech")),
                "rows": [],
            },
        )
        buckets.setdefault((group_name, category), []).append(row)

    for (group_name, category), category_rows in buckets.items():
        group = groups_by_name[group_name]
        evidence = []
        for row in category_rows:
            for item in re.split(r"\s*;\s*", clean_text(row.get("evidence"))):
                if item and item not in evidence:
                    evidence.append(item)
        group["rows"].append(
            {
                "dtmf": dtmf_for_grouped_rows(category_rows),
                "category": category,
                "treatment": summarize_menu_treatment(group, category_rows),
                "evidence": evidence[:8],
            }
        )

    groups = list(groups_by_name.values())
    for group in groups:
        group["rows"] = sorted(group.get("rows") or [], key=lambda row: (clean_text(row.get("dtmf")), clean_text(row.get("category"))))
    groups.sort(key=lambda group: clean_text(group.get("groupName")).lower())
    return {"title": "Mapa editavel dos menus por grupo", "groups": groups}


def build_skill_map_groups(skill_map_rows: List[Dict[str, Any]], menu_map_rows: List[Dict[str, Any]], semantic_model: Dict[str, Any], ai_organizer: Dict[str, Any]) -> Dict[str, Any]:
    groups_by_name: Dict[str, Dict[str, Any]] = {}
    seen = set()
    for row in skill_map_rows:
        group_name = infer_map_group(row, semantic_model, ai_organizer)
        groups_by_name.setdefault(group_name, {"groupName": group_name, "rows": []})
        subject = infer_menu_category({"label": row.get("subject"), "skillName": row.get("skillName"), "destination": row.get("skillName")})
        item = {
            "subject": subject,
            "skillId": clean_text(row.get("skillId")),
            "skillName": clean_text(row.get("skillName")),
            "evidence": clean_text(row.get("evidence")),
        }
        key = (group_name, item["subject"], item["skillId"], item["skillName"], item["evidence"])
        if key in seen:
            continue
        seen.add(key)
        groups_by_name[group_name]["rows"].append(item)

    groups = list(groups_by_name.values())
    for group in groups:
        group["rows"] = sorted(group.get("rows") or [], key=lambda row: (clean_text(row.get("subject")), clean_text(row.get("skillName"))))
    groups.sort(key=lambda group: clean_text(group.get("groupName")).lower())
    return {"title": "Mapa editavel de skills de destino", "groups": groups}


def build_drawio_plan(raw_actions: Dict[str, Any], pre_semantic_extract: Dict[str, Any], ai_organizer: Dict[str, Any], human_routes: Dict[str, Any], semantic_model: Dict[str, Any], navigation_story: Dict[str, Any], visual_blocks: Optional[Dict[str, Any]] = None, execution_model: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    visual_blocks = visual_blocks or build_visual_blocks(navigation_story, semantic_model, ai_organizer)
    execution_model = execution_model or semantic_model.get("executionModel") or {}
    menu_map_rows = build_menu_map_rows_v2(execution_model, semantic_model, navigation_story, ai_organizer)
    skill_map_rows = build_skill_map_rows_v2(menu_map_rows)
    menu_map_groups = build_menu_map_groups(menu_map_rows, semantic_model, ai_organizer)
    skill_map_groups = build_skill_map_groups(skill_map_rows, menu_map_rows, semantic_model, ai_organizer)
    return {
        "navigationStory": navigation_story,
        "visualBlocks": visual_blocks,
        "businessBlocks": visual_blocks,
        "executionModel": execution_model,
        "menuMapRows": menu_map_rows,
        "skillMapRows": skill_map_rows,
        "menuMapGroups": menu_map_groups,
        "skillMapGroups": skill_map_groups,
        "pages": [
            {
                "name": "Fluxo Principal",
                "type": "main_flow",
                "navigationStory": navigation_story,
                "visualBlocks": visual_blocks,
                "context": ai_organizer.get("flowContext", {}),
            },
            {"name": "Mapa de Menus", "type": "menu_map", "menuMapRows": menu_map_rows, "menuMapGroups": menu_map_groups},
            {"name": "Mapa de Skills", "type": "skill_map", "skillMapRows": skill_map_rows, "skillMapGroups": skill_map_groups},
            {"name": "Fluxograma Técnico Editável", "type": "technical_graph", "group": "all", "nodes": raw_actions.get("actions", []), "edges": raw_actions.get("edges", [])},
        ]
    }


def plan_table_page(name: str, headers: List[str], rows: List[List[Any]], width: int = 1600) -> str:
    cells = [mx_node(f"{safe_drawio_id(name)}_title", name, 350, 25, 900, 42, "title")]
    col_width = max(120, (width - 80) // max(len(headers), 1))
    y = 95
    x = 40
    for col, header in enumerate(headers):
        cells.append(table_cell(f"{safe_drawio_id(name)}_h_{col}", header, x + col * col_width, y, col_width, 34, True))
    for row_index, row in enumerate(rows[:120]):
        for col, value in enumerate(row[: len(headers)]):
            cells.append(table_cell(f"{safe_drawio_id(name)}_{row_index}_{col}", short_label(value, 120), x + col * col_width, y + 34 + row_index * 34, col_width, 34))
    return mx_diagram(name, cells, width, max(900, y + 110 + len(rows[:120]) * 34))


def grouped_map_page(name: str, title: str, groups: List[Dict[str, Any]], headers: List[Tuple[str, int]], row_keys: List[str], width: int = 1500) -> str:
    cells = [
        mx_node(f"{safe_drawio_id(name)}_title", title or name, 300, 25, 900, 42, "title"),
        mx_node(f"{safe_drawio_id(name)}_sub", "Visao funcional agrupada gerada a partir do XML NICE. Detalhes tecnicos permanecem nos JSONs e no fluxograma tecnico.", 180, 70, 1150, 34, "subtitle"),
    ]
    x0 = 60
    y = 130
    group_width = sum(width_value for _label, width_value in headers)
    for group_index, group in enumerate(groups[:24]):
        group_name = clean_text(group.get("groupName") or f"Grupo {group_index + 1}")
        source_bits = [clean_text(group.get("source")), clean_text(group.get("menuActionId")), clean_text(group.get("prompt"))]
        source_line = " | ".join(item for item in source_bits if item)
        header_label = group_name + (f"\n{short_label(source_line, 130)}" if source_line else "")
        cells.append(mx_node(f"{safe_drawio_id(name)}_g_{group_index}", header_label, x0, y, group_width, 54, "lane_header"))
        y += 54
        x = x0
        for header_index, (header_label_text, col_width) in enumerate(headers):
            cells.append(table_cell(f"{safe_drawio_id(name)}_g_{group_index}_h_{header_index}", header_label_text, x, y, col_width, 34, True))
            x += col_width
        rows = [row for row in group.get("rows") or [] if isinstance(row, dict)]
        if not rows:
            rows = [{key: "-" for key in row_keys}]
        for row_index, row in enumerate(rows[:40]):
            x = x0
            row_height = 46 if len(row_keys) <= 3 else 50
            for col_index, ((_header, col_width), key) in enumerate(zip(headers, row_keys)):
                cells.append(table_cell(f"{safe_drawio_id(name)}_g_{group_index}_r_{row_index}_{col_index}", short_label(row.get(key), 150), x, y + 34 + row_index * row_height, col_width, row_height))
                x += col_width
        y += 34 + max(1, len(rows[:40])) * (46 if len(row_keys) <= 3 else 50) + 45
    if not groups:
        cells.append(mx_node(f"{safe_drawio_id(name)}_empty", "Nenhum dado funcional identificado para este mapa.", 360, 170, 700, 100, "note"))
    return mx_diagram(name, cells, max(width, group_width + 120), max(900, y + 100))


def empty_table_page(name: str, message: str, width: int = 1500) -> str:
    cells = [
        mx_node(f"{safe_drawio_id(name)}_title", name, 350, 25, 900, 42, "title"),
        mx_node(f"{safe_drawio_id(name)}_empty", message, 300, 150, 900, 110, "note"),
    ]
    return mx_diagram(name, cells, width, 900)


def render_rule_step_label(step: Dict[str, Any]) -> str:
    lines = [short_label(step.get("displayLabel"), 70)]
    if clean_text(step.get("api")):
        lines.append(short_label(step.get("api"), 70))
    audio = step.get("audio") or {}
    audio_line = render_audio_line(audio)
    if audio_line:
        lines.append(audio_line)
    composed = step.get("composedAudio") or {}
    if clean_text(composed.get("variable")):
        lines.append(short_label(f"Audio dinamico: {composed.get('variable')}", 70))
    candidates = [clean_text(item) for item in composed.get("candidates") or [] if clean_text(item)]
    if candidates:
        lines.append("Possiveis audios:")
        lines.extend(short_label(item, 68) for item in candidates[:4])
    dynamic_parts = [clean_text(item) for item in composed.get("dynamicParts") or [] if clean_text(item)]
    if dynamic_parts:
        lines.append(short_label("Inclui: " + ", ".join(dynamic_parts[:3]), 78))
    rules = [clean_text(item) for item in step.get("rules") or [] if clean_text(item)]
    if rules:
        lines.extend("- " + short_label(item, 76) for item in rules[:5])
    if clean_text(step.get("nextStep")):
        lines.append(short_label(clean_option_label_token(step.get("nextStep")) or step.get("nextStep"), 70))
    branches = [branch for branch in step.get("branches") or [] if isinstance(branch, dict)]
    if branches:
        lines.extend(short_label(f"{branch.get('label')} -> {branch.get('target')}", 76) for branch in branches[:3])
    return "\n".join(line for line in lines if clean_text(line))


def render_visual_block_label(block: Dict[str, Any]) -> str:
    lines = [short_label(block.get("label") or block.get("displayLabel"), 72)]
    subtitle = clean_display_text(block.get("subtitle") or block.get("secondaryLabel"))
    if not block.get("hideCondition") and should_render_condition(block.get("label") or block.get("displayLabel"), subtitle):
        lines.append(short_label(subtitle, 72))
    audio_line = render_audio_line(block.get("audio") or {})
    if audio_line:
        lines.append(audio_line)
    composed = block.get("composedAudio") or {}
    if clean_text(composed.get("variable")):
        lines.append(short_label(f"Audio dinamico: {composed.get('variable')}", 72))
    candidates = [clean_text(item) for item in composed.get("candidates") or [] if clean_text(item) and not is_auxiliary_audio_file(item)]
    if candidates:
        lines.append("Possiveis audios:")
        lines.extend(short_label(item, 68) for item in candidates[:4])
    dynamic_parts = [clean_text(item) for item in composed.get("dynamicParts") or [] if clean_text(item)]
    if dynamic_parts:
        lines.append(short_label("Inclui: " + ", ".join(dynamic_parts[:3]), 78))
    rules = [clean_text(item) for item in block.get("rules") or [] if clean_text(item)]
    if rules:
        lines.extend("- " + short_label(item, 76) for item in rules[:5])
    next_step = clean_text(block.get("nextStep"))
    if next_step:
        lines.append(short_label(clean_option_label_token(next_step) or next_step, 70))
    return "\n".join(unique_visual_lines(lines))


def visual_block_style(block: Dict[str, Any]) -> str:
    kind = clean_text(block.get("type")).lower()
    if kind == "start":
        return "terminal_start"
    if kind in {"decision", "rule_group", "menu"}:
        return "decision"
    if kind in {"api", "routing", "transfer"}:
        return "transfer"
    if kind == "end":
        return "terminal_end"
    if kind == "loop":
        return "warning"
    if kind == "play":
        return "process"
    return "process"


def visual_block_height(block: Dict[str, Any]) -> int:
    height = 90
    height += min(len(block.get("rules") or []), 5) * 18
    if (block.get("composedAudio") or {}).get("candidates"):
        height += min(len((block.get("composedAudio") or {}).get("candidates") or []), 4) * 16 + 30
    if render_audio_line(block.get("audio") or {}):
        height += 16
    return min(max(height, 86), 220)


def hours_side_depth(step: Dict[str, Any]) -> int:
    return max((len(branch.get("blocks") or []) for branch in step.get("sideBranches") or [] if isinstance(branch, dict)), default=0)


def hours_side_branch_height(branch: Dict[str, Any]) -> int:
    blocks = [block for block in branch.get("blocks") or [] if isinstance(block, dict)]
    if not blocks:
        return 58
    total = 0
    for index, block in enumerate(blocks[:5]):
        kind = clean_text(block.get("type")).lower()
        total += 44 if kind in {"end", "terminal"} else 68
        if index < min(len(blocks), 5) - 1:
            total += 18
    return total


def hours_side_total_height(step: Dict[str, Any]) -> int:
    branches = [branch for branch in step.get("sideBranches") or [] if isinstance(branch, dict)]
    if not branches:
        return 0
    return sum(hours_side_branch_height(branch) for branch in branches[:4]) + max(0, len(branches[:4]) - 1) * 26


def visual_step_layout_units(step: Dict[str, Any]) -> int:
    side_height = hours_side_total_height(step)
    if side_height:
        return max(1, (side_height + 125) // 128)
    return max(1, hours_side_depth(step))


def flow_item_layout_units(flow_item: Dict[str, Any]) -> int:
    steps = (flow_item.get("visibleSteps") or flow_item.get("steps") or [])[:18]
    return max(1, sum(visual_step_layout_units(step) for step in steps if isinstance(step, dict)))


def hours_side_block_style(block: Dict[str, Any]) -> str:
    kind = clean_text(block.get("type")).lower()
    if kind in {"end", "terminal"}:
        return "terminal_end"
    if kind in {"runscript", "runsub", "rest_api", "reqagent", "transfer", "api", "routing"}:
        return "transfer"
    if kind in {"decision", "if", "hours", "menu"}:
        return "decision"
    if kind in {"loop", "continuation"}:
        return "warning"
    return "process"


def render_hours_side_block_label(block: Dict[str, Any]) -> str:
    lines = [short_label(block.get("displayLabel") or block.get("label"), 42)]
    secondary = clean_display_text(block.get("secondaryLabel") or block.get("resolvedTarget") or block.get("nextStep") or block.get("transferCode"))
    if secondary and should_render_condition(lines[0] if lines else "", secondary):
        lines.append(short_label(secondary, 42))
    audio_line = render_audio_line(block.get("audio") or {})
    if audio_line:
        lines.append(short_label(audio_line.replace("Áudio: ", ""), 42))
    if not any(clean_text(line) for line in lines):
        lines.append(short_label(block.get("actionId") or "Destino não detalhado", 54))
    return "\n".join(unique_visual_lines(lines))


def render_hours_side_branches(cells: List[str], source_id: str, step: Dict[str, Any], prefix: str, source_x: int, source_y: int, source_w: int, page_width: int = 1600, reserved_right: int = 0) -> int:
    side_branches = [branch for branch in step.get("sideBranches") or [] if isinstance(branch, dict)]
    if not side_branches:
        return source_y + 116
    side_w = 190
    gap = 20
    side_x = source_x + source_w + gap
    if reserved_right and side_x + side_w > source_x + source_w + reserved_right:
        side_x = source_x + max(0, source_w - side_w)
    if side_x + side_w > page_width - 35:
        side_x = max(35, source_x - side_w - gap)
    bottom = source_y + 116
    branch_y = source_y
    for branch_index, branch in enumerate(side_branches[:4]):
        blocks = [block for block in branch.get("blocks") or [] if isinstance(block, dict)]
        if not blocks:
            blocks = [
                {
                    "type": "continuation",
                    "displayLabel": "Destino não detalhado",
                    "secondaryLabel": branch.get("targetActionId"),
                }
            ]
        previous = source_id
        child_y = branch_y
        for block_index, block in enumerate(blocks[:5]):
            block_id = f"{prefix}_hours_{branch_index}_{block_index}_{safe_drawio_id(block.get('actionId') or block.get('displayLabel') or branch.get('label'))}"
            is_end = clean_text(block.get("type")).lower() in {"end", "terminal"}
            block_h = 44 if is_end else 68
            block_w = 120 if is_end else side_w
            block_x = side_x + (side_w - block_w) // 2 if is_end else side_x
            cells.append(mx_node(block_id, render_hours_side_block_label(block), block_x, child_y, block_w, block_h, hours_side_block_style(block)))
            cells.append(mx_edge(f"{block_id}_edge", previous, block_id, clean_text(branch.get("label")) if block_index == 0 else "segue"))
            previous = block_id
            child_y += block_h + 18
        bottom = max(bottom, child_y)
        branch_y = child_y + 26
    return bottom


def render_hours_step_with_side_branches(cells: List[str], step: Dict[str, Any], step_id: str, x: int, y: int, width: int, label: str, page_width: int = 1600, reserved_right: int = 0) -> int:
    node_label = clean_text(label) or hours_display_label({"actionId": step.get("actionId"), "parameters": [step.get("hoursKey")] if step.get("hoursKey") else []})
    cells.append(mx_node(step_id, node_label, x, y, width, 116, "decision"))
    return render_hours_side_branches(cells, step_id, step, step_id, x, y, width, page_width, reserved_right)


def render_rule_flow_page(story: Dict[str, Any], context: Dict[str, Any], semantic_model: Dict[str, Any], visual_blocks: Optional[Dict[str, Any]] = None) -> str:
    flow_kind = story.get("flowKind") or {}
    project = semantic_model.get("project") or {}
    title = clean_text(context.get("flowName") or project.get("name") or "Fluxo Principal")
    subtitle = clean_text(context.get("businessPurpose") or flow_kind.get("reason") or "Fluxo funcional gerado a partir das regras reais do XML NICE.")
    cells = [
        mx_node("rule_main_title", title, 330, 25, 900, 42, "title"),
        mx_node("rule_main_context", short_label(subtitle, 180), 230, 70, 1100, 34, "subtitle"),
    ]
    steps = (visual_blocks or {}).get("blocks") or [
        build_visual_block_from_step(step, semantic_model, step.get("context") or {})
        for step in story.get("businessStory") or []
        if isinstance(step, dict)
    ]
    x = 610
    y = 135
    prev_id = ""
    pending_main_label = ""
    max_bottom = y
    for index, step in enumerate(steps[:24]):
        step_id = f"rule_step_{index}_{safe_drawio_id(step.get('actionId') or step.get('nodeKey'))}"
        height = visual_block_height(step)
        if step.get("sideBranches"):
            max_bottom = max(max_bottom, render_hours_step_with_side_branches(cells, step, step_id, x, y, 380, render_visual_block_label(step)))
        else:
            cells.append(mx_node(step_id, render_visual_block_label(step), x, y, 380, height, visual_block_style(step)))
        if prev_id:
            cells.append(mx_edge(f"rule_e_{index}", prev_id, step_id, pending_main_label or "segue"))
        pending_main_label = ""
        if step.get("sideBranches"):
            pending_main_label = clean_text((step.get("mainBranch") or {}).get("label")) or "Aberto"
        for branch_index, branch in enumerate((step.get("branches") or [])[:2]):
            lane_x = 1050 if branch_index == 0 else 175
            branch_y = y + branch_index * 95
            branch_root_id = f"{step_id}_branch_{branch_index}"
            branch_children = branch.get("children") or []
            branch_title = "\n".join(
                line
                for line in [
                    short_label(branch.get("label"), 34),
                    short_label(branch.get("target"), 64),
                ]
                if clean_text(line)
            )
            if branch_children:
                first_child = branch_children[0]
                child_id = f"{branch_root_id}_child_0_{safe_drawio_id(first_child.get('nodeKey') or first_child.get('actionId'))}"
                cells.append(mx_node(child_id, render_visual_block_label(first_child), lane_x, branch_y, 300, visual_block_height(first_child), visual_block_style(first_child)))
                cells.append(mx_edge(f"{branch_root_id}_edge", step_id, child_id, clean_text(branch.get("label"))))
                previous_child = child_id
                child_y = branch_y + visual_block_height(first_child) + 55
                for child_index, child in enumerate(branch_children[1:5], start=1):
                    next_child_id = f"{branch_root_id}_child_{child_index}_{safe_drawio_id(child.get('nodeKey') or child.get('actionId'))}"
                    child_h = visual_block_height(child)
                    cells.append(mx_node(next_child_id, render_visual_block_label(child), lane_x, child_y, 300, child_h, visual_block_style(child)))
                    cells.append(mx_edge(f"{branch_root_id}_child_e_{child_index}", previous_child, next_child_id, "segue"))
                    previous_child = next_child_id
                    child_y += child_h + 55
                max_bottom = max(max_bottom, child_y)
            else:
                cells.append(mx_node(branch_root_id, branch_title, lane_x, branch_y, 250, 78, "warning"))
                cells.append(mx_edge(f"{branch_root_id}_edge", step_id, branch_root_id, clean_text(branch.get("label"))))
                max_bottom = max(max_bottom, branch_y + 95)
        prev_id = step_id
        y += max(height, visual_step_layout_units(step) * 110) + 82
        max_bottom = max(max_bottom, y)
    if not steps:
        cells.append(mx_node("rule_empty", "Nenhuma jornada funcional foi identificada.\nConsulte o Fluxograma Tecnico Editavel.", 470, 180, 520, 120, "note"))
    return mx_diagram("Fluxo Principal", cells, 1600, max(1050, max_bottom + 180))


def render_drawio_from_plan(plan: Dict[str, Any], semantic_model: Dict[str, Any], ai: Dict[str, Any]) -> str:
    diagrams = []
    semantic_ai = semantic_model.get("aiOrganizer") if isinstance(semantic_model.get("aiOrganizer"), dict) else {}
    actions_map_all = action_by_id(semantic_model)
    actions_by_group: Dict[str, List[Dict[str, Any]]] = {}
    for action in semantic_model.get("actions", []):
        actions_by_group.setdefault(clean_text(action.get("group") or technical_group_for_action(action)), []).append(action)

    for page in plan.get("pages", []):
        name = page.get("name")
        ptype = page.get("type")
        if ptype in {"main_flow", "functional_overview"}:
            story = page.get("navigationStory") or plan.get("navigationStory") or {}
            context = page.get("context", {})
            flow_kind = (story.get("flowKind") or {}).get("kind")
            if flow_kind in {"rule_flow", "api_flow"}:
                diagrams.append(render_rule_flow_page(story, context, semantic_model, page.get("visualBlocks") or plan.get("visualBlocks")))
                continue
            cells = [
                mx_node("plan_main_title", clean_text(context.get("flowName") or name or "Fluxo Principal"), 330, 25, 900, 42, "title"),
                mx_node("plan_main_context", short_label(context.get("businessPurpose") or "Visao funcional humanizada gerada a partir do XML NICE.", 180), 230, 70, 1100, 34, "subtitle"),
            ]
            pre_nodes = story.get("preMenu") or []
            previous = ""
            pre_pending_main_label = ""
            pre_stop_before_menu = False
            center_x = 670
            y = 125
            for index, item in enumerate(pre_nodes[:8]):
                action = actions_map_all.get(clean_text(item.get("actionId")))
                display_node = build_display_node_from_action(action, semantic_model, semantic_ai) if action else item
                if display_node.get("hideFromMainFlow"):
                    continue
                node_id = f"story_pre_{index}_{safe_drawio_id(item.get('actionId'))}"
                label = render_main_flow_display_node(display_node)
                if not clean_text(label):
                    continue
                node_h = 110 if clean_text(display_node.get("conditionLabel")) or clean_text((display_node.get("audio") or {}).get("fileName")) else 78
                if clean_text(item.get("type")).upper() == "HOURS" and item.get("sideBranches"):
                    node_h = 116
                    render_hours_step_with_side_branches(cells, item, node_id, center_x, y, 300, label)
                else:
                    cells.append(
                        mx_node(
                            node_id,
                            label,
                            center_x,
                            y,
                            300,
                            node_h,
                            clean_text(item.get("shape")) or ("decision" if item.get("type") == "IF" else "process"),
                        )
                    )
                if previous:
                    cells.append(mx_edge(f"story_pre_e_{index}", previous, node_id, pre_pending_main_label or "segue"))
                pre_pending_main_label = ""
                branches = item.get("branches") or []
                if clean_text(item.get("type")).upper() in {"IF", "HOURS"} and branches:
                    for branch_index, branch in enumerate(branches[:2]):
                        branch_id = f"{node_id}_branch_{branch_index}"
                        branch_x = 1020 if branch_index == 0 else 325
                        branch_y = y + branch_index * 82
                        branch_label = "\n".join(
                            [
                                short_label(branch.get("label"), 34),
                                short_label(branch.get("meaning"), 58),
                            ]
                        )
                        cells.append(mx_node(branch_id, branch_label, branch_x, branch_y, 250, 76, "warning"))
                        cells.append(mx_edge(f"{branch_id}_edge", node_id, branch_id, clean_text(branch.get("label"))))
                previous = node_id
                if clean_text(item.get("type")).upper() == "HOURS":
                    pre_pending_main_label = clean_text((item.get("mainBranch") or {}).get("label")) or "Aberto"
                if item.get("stopBeforeMenu"):
                    pre_stop_before_menu = True
                y += max(145, visual_step_layout_units(item) * 110 + 45)

            main_menu = story.get("mainMenu") or {}
            main_action = actions_map_all.get(clean_text(main_menu.get("actionId")))
            main_display = build_display_node_from_action(main_action, semantic_model, semantic_ai) if main_action else main_menu
            menu_audio = main_menu.get("audio") or {}
            menu_options = main_menu.get("options") or []
            if not (main_display.get("audio") or {}).get("fileName") and menu_audio.get("fileName"):
                main_display = {**main_display, "audio": menu_audio}
            menu_label = render_main_flow_display_node(main_display, menu_options)
            cells.append(mx_node("story_main_menu", menu_label, 610, y + 10, 390, 190, "decision"))
            if previous and not pre_stop_before_menu:
                cells.append(mx_edge("story_menu_in", previous, "story_main_menu", "segue"))
            loop_items = story.get("loops") or []
            for loop_index, loop in enumerate(loop_items[:2]):
                loop_id = f"story_main_loop_{loop_index}"
                loop_label = "\n".join(
                    line
                    for line in [
                        short_label(loop.get("label") or "Loop de tentativas", 42),
                        short_label(loop.get("attempts"), 42),
                        short_label(f"{loop.get('repeatLabel') or 'Repetir'} -> volta ao menu", 52),
                        short_label(f"{loop.get('finishedLabel') or 'Finalizado'} -> {loop.get('finishedTargetLabel') or 'Fim'}", 52),
                    ]
                    if clean_text(line)
                )
                loop_x = 1050 + loop_index * 245
                loop_y = y + 35 + loop_index * 115
                cells.append(mx_node(loop_id, loop_label, loop_x, loop_y, 230, 110, "warning"))
                cells.append(mx_edge(f"{loop_id}_repeat", loop_id, "story_main_menu", "retorno"))
                finish_audio = audio_context_for_file(loop.get("audioOnFinished"), semantic_model, "loop") if clean_text(loop.get("audioOnFinished")) else {"fileName": "", "transcription": ""}
                finish_label = "\n".join(line for line in [clean_text(loop.get("finishedTargetLabel") or "Fim"), render_audio_line(finish_audio)] if clean_text(line))
                finish_id = f"{loop_id}_finish"
                cells.append(mx_node(finish_id, finish_label or "Fim", loop_x, loop_y + 135, 230, 72, "terminal_end"))
                cells.append(mx_edge(f"{loop_id}_finish_e", loop_id, finish_id, "finalizado"))
            y += 270

            option_flows = story.get("optionFlows") or []
            has_hours_side_branches = any(
                any((step.get("sideBranches") for step in (flow_item.get("visibleSteps") or flow_item.get("steps") or []) if isinstance(step, dict)))
                for flow_item in option_flows
                if isinstance(flow_item, dict)
            )
            lane_xs = [55, 555, 1055] if has_hours_side_branches else [55, 365, 675, 985, 1295]
            lane_w = 270
            lane_slot_w = 500 if has_hours_side_branches else 270
            row_h = 128
            flow_limit = min(len(option_flows), 10)
            max_steps = 0
            for index, flow_item in enumerate(option_flows[:flow_limit]):
                col = index % len(lane_xs)
                row = index // len(lane_xs)
                x = lane_xs[col]
                row_flows = option_flows[row * len(lane_xs) : (row + 1) * len(lane_xs)]
                row_max_steps = max((flow_item_layout_units(item) for item in row_flows), default=1)
                row_block_height = 165 + min(max(row_max_steps, 1), 18) * row_h + 170
                base_y = y + sum(
                    165 + min(max(max((flow_item_layout_units(item) for item in option_flows[r * len(lane_xs) : (r + 1) * len(lane_xs)]), default=1), 1), 18) * row_h + 170
                    for r in range(row)
                )
                option_id = f"story_option_{index}_{safe_drawio_id(flow_item.get('digit'))}"
                option_label = "\n".join(
                    [
                        f"{clean_text(flow_item.get('digit'))} - {short_label(flow_item.get('label'), 44)}",
                    ]
                )
                cells.append(mx_node(option_id, option_label, x, base_y, lane_w, 105, "process"))
                cells.append(mx_edge(f"story_option_e_{index}", "story_main_menu", option_id, clean_text(flow_item.get("digit"))))
                previous_node = option_id
                steps = flow_item.get("visibleSteps") or flow_item.get("steps") or []
                max_steps = max(max_steps, len(steps))
                visible_step_index = 0
                option_pending_main_label = ""
                for step_index, step in enumerate(steps[:18]):
                    step_action = actions_map_all.get(clean_text(step.get("actionId")))
                    base_display = build_display_node_from_action(step_action, semantic_model, semantic_ai) if step_action else {}
                    display_node = {
                        **base_display,
                        "displayLabel": step.get("displayLabel") or step.get("label"),
                        "secondaryLabel": step.get("secondaryLabel", ""),
                        "conditionLabel": step.get("conditionLabel", ""),
                        "audio": step.get("audio") or {},
                        "hideFromMainFlow": False,
                        "hideCondition": bool(step.get("hideCondition")),
                        "technicalCondition": clean_text(step.get("technicalCondition")),
                    }
                    if step.get("type") == "snippet_case":
                        display_node = {
                            **display_node,
                            "displayLabel": "Define saida da opcao",
                            "conditionLabel": clean_display_text(step.get("conditionLabel")),
                            "audio": step.get("audio") or display_node.get("audio") or {},
                            "hideFromMainFlow": False,
                        }
                    if display_node.get("hideFromMainFlow"):
                        continue
                    step_id = f"story_option_{index}_step_{step_index}_{safe_drawio_id(step.get('actionId'))}"
                    step_lines = [render_main_flow_display_node(display_node)]
                    if clean_text(step.get("nextStep")):
                        step_lines.append("Saida: " + short_label(step.get("nextStep"), 44))
                    if clean_text(step.get("transferCode")):
                        step_lines.append("Transfer: " + short_label(step.get("transferCode"), 44))
                    if clean_text(step.get("resolvedTarget")) and not clean_text(step.get("nextStep")) and not clean_text(step.get("transferCode")):
                        step_lines.append("Saida: " + short_label(step.get("resolvedTarget"), 44))
                    step_kind = clean_text(step.get("type")).lower()
                    style = (
                        "decision"
                        if step_kind in {"if", "hours", "case", "decision", "menu"}
                        else "transfer"
                        if step_kind in {"runscript", "runsub", "rest_api", "reqagent", "transfer", "api"}
                        else "terminal_end"
                        if step_kind in {"end", "terminal", "continuation"}
                        else "process"
                    )
                    step_y = base_y + 140 + visible_step_index * row_h
                    if step_kind in {"hours", "decision"} and step.get("sideBranches"):
                        render_hours_step_with_side_branches(cells, step, step_id, x, step_y, lane_w, "\n".join(line for line in step_lines if clean_text(line)), reserved_right=lane_slot_w - lane_w)
                    else:
                        cells.append(mx_node(step_id, "\n".join(line for line in step_lines if clean_text(line)), x, step_y, lane_w, 116, style))
                    cells.append(mx_edge(f"story_option_{index}_step_e_{step_index}", previous_node, step_id, option_pending_main_label or clean_text(step.get("edgeLabel")) or "segue"))
                    option_pending_main_label = ""
                    previous_node = step_id
                    if step.get("sideBranches"):
                        option_pending_main_label = clean_text((step.get("mainBranch") or {}).get("label")) or "Aberto"
                    visible_step_index += visual_step_layout_units(step)
                treatments = flow_item.get("sideTreatments") or []
                if treatments:
                    treatment_id = f"story_option_{index}_treatments"
                    treatment_lines = [
                        short_label(item.get("label") or "Tratamento alternativo", 46)
                        for item in treatments[:4]
                    ]
                    cells.append(mx_node(treatment_id, "Loop / tratamento\n" + "\n".join(treatment_lines), x, base_y + 140 + flow_item_layout_units(flow_item) * row_h, lane_w, 105, "warning"))
                    cells.append(mx_edge(f"story_option_{index}_treatments_e", option_id, treatment_id, "timeout/invalido"))
                    cells.append(mx_edge(f"story_option_{index}_treatments_return", treatment_id, option_id, "retorno"))
                terminal = flow_item.get("terminal") or {}
                if clean_text(terminal.get("label")) and previous_node != option_id:
                    terminal_id = f"story_option_{index}_terminal"
                    terminal_label = clean_option_label_token(terminal.get("label")) or "Fim"
                    terminal_style = "terminal_end" if clean_text(terminal.get("type")).lower() in {"end", "runscript", "terminal", "loop"} else "transfer"
                    cells.append(mx_node(terminal_id, short_label(terminal_label, 54), x, base_y + 140 + visible_step_index * row_h, lane_w, 72, terminal_style))
                    cells.append(mx_edge(f"story_option_{index}_terminal_e", previous_node, terminal_id, "fim"))

            rows_count = max(1, (flow_limit + len(lane_xs) - 1) // len(lane_xs))
            bottom_y = y + sum(
                165 + min(max(max((flow_item_layout_units(item) for item in option_flows[r * len(lane_xs) : (r + 1) * len(lane_xs)]), default=1), 1), 18) * row_h + 170
                for r in range(rows_count)
            )
            side_events = story.get("sideEvents") or []
            if side_events:
                side_lines = [short_label(item.get("label") or item.get("type"), 58) for item in side_events[:7]]
                cells.append(mx_node("story_side_events", "Eventos laterais / CDR\n" + "\n".join(side_lines), 60, bottom_y, 430, 145, "note"))
            cells.append(mx_node("story_end", "Transferencia / API / encerramento\nDetalhes nos mapas e tecnico editavel", 650, bottom_y + 30, 330, 85, "terminal_end"))
            diagrams.append(mx_diagram("Fluxo Principal", cells, 1600, max(1050, bottom_y + 230)))
        elif ptype == "menu_map":
            flow_kind = ((plan.get("navigationStory") or {}).get("flowKind") or {}).get("kind")
            if flow_kind in {"rule_flow", "api_flow"} or not functional_menus(semantic_model):
                diagrams.append(empty_table_page("Mapa de Menus", "Este XML nao possui menus DTMF identificados.", 1500))
                continue
            menu_rows = page.get("menuMapRows") or plan.get("menuMapRows") or []
            if not menu_rows:
                diagrams.append(empty_table_page("Mapa de Menus", "Este XML nao possui menus DTMF identificados.", 1500))
                continue
            groups_payload = page.get("menuMapGroups") or plan.get("menuMapGroups") or {}
            diagrams.append(
                grouped_map_page(
                    "Mapa de Menus",
                    clean_text(groups_payload.get("title")) or "Mapa editavel dos menus por grupo",
                    groups_payload.get("groups") or [],
                    [("DTMF", 90), ("Categoria", 300), ("Tratamento", 720)],
                    ["dtmf", "category", "treatment"],
                    1400,
                )
            )
        elif ptype == "skill_map":
            skill_rows = page.get("skillMapRows") or plan.get("skillMapRows") or []
            if not skill_rows:
                diagrams.append(empty_table_page("Mapa de Skills", "Este XML nao possui skills identificadas.", 1500))
                continue
            groups_payload = page.get("skillMapGroups") or plan.get("skillMapGroups") or {}
            diagrams.append(
                grouped_map_page(
                    "Mapa de Skills",
                    clean_text(groups_payload.get("title")) or "Mapa editavel de skills de destino",
                    groups_payload.get("groups") or [],
                    [("Ramo/Assunto", 420), ("Skill ID", 180), ("Skill Name", 470)],
                    ["subject", "skillId", "skillName"],
                    1400,
                )
            )
        elif ptype == "technical_graph":
            group = clean_text(page.get("group"))
            if group == "all":
                order, levels = navigation_order(semantic_model)
                action_lookup = action_by_id(semantic_model)
                group_actions = [action_lookup[aid] for aid in order if aid in action_lookup]
            else:
                group_actions = actions_by_group.get(group, [])
                levels = {clean_text(action.get("actionId")): index // 5 for index, action in enumerate(group_actions)}
            cells = [
                mx_node("tech_full_title", "Fluxograma Técnico Editável", 350, 25, 900, 42, "title"),
                mx_node("tech_full_sub", "Grafo tecnico completo do NICE com todas as actions e conexoes reais extraidas do XML.", 230, 70, 1100, 34, "subtitle"),
            ]
            node_ids = {}
            columns = 5
            node_w = 285
            x_gap = 335
            y_gap = 140
            level_sizes: Dict[int, int] = {}
            for action in group_actions:
                aid = clean_text(action.get("actionId"))
                level_sizes[levels.get(aid, 0)] = level_sizes.get(levels.get(aid, 0), 0) + 1
            level_y: Dict[int, int] = {}
            cursor_y = 125
            for level in sorted(level_sizes):
                level_y[level] = cursor_y
                rows_in_level = max(1, (level_sizes[level] + columns - 1) // columns)
                cursor_y += rows_in_level * y_gap + 35
            level_counts: Dict[int, int] = {}
            for action in group_actions:
                aid = clean_text(action.get("actionId"))
                level = levels.get(aid, 0)
                col = level_counts.get(level, 0)
                level_counts[level] = col + 1
                node_id = f"tech_full_{safe_drawio_id(aid)}"
                node_ids[aid] = node_id
                cells.append(
                    mx_node(
                        node_id,
                        compact_action_summary(action, prompt_index_by_action(semantic_model)),
                        50 + min(col, columns - 1) * x_gap,
                        level_y.get(level, 125) + (col // columns) * y_gap,
                        node_w,
                        100,
                        action_style(action),
                    )
                )
            edge_index = 0
            for edge in semantic_model.get("edges", []):
                source = clean_text(edge.get("source"))
                target = clean_text(edge.get("target"))
                if source in node_ids and target in node_ids:
                    edge_index += 1
                    cells.append(mx_edge(f"tech_full_e_{edge_index}", node_ids[source], node_ids[target], edge_label(edge)))
            diagrams.append(mx_diagram("Fluxograma Técnico Editável", cells, 1800, max(1000, cursor_y + 140)))
    return "".join(diagrams)


def build_drawio(flow: Dict[str, Any], ai: Dict[str, Any]) -> str:
    modified = html.escape(datetime.now(timezone.utc).isoformat())
    semantic_model = flow.get("semanticModel")
    semantic_routes = flow.get("semanticRoutes")
    drawio_plan = flow.get("drawioPlan")
    if semantic_model and semantic_routes and drawio_plan:
        diagrams = render_drawio_from_plan(drawio_plan, semantic_model, ai)
        return f'<mxfile host="app.diagrams.net" modified="{modified}" agent="Dev Flow" version="24.7.17" type="device">{diagrams}</mxfile>'
    return (
        f'<mxfile host="app.diagrams.net" modified="{modified}" agent="Dev Flow" version="24.7.17" type="device">'
        + build_main_flow_page(flow, ai)
        + build_menu_table_page(flow)
        + build_skill_table_page(flow)
        + build_single_technical_page(flow, ai)
        + "</mxfile>"
    )


def build_processing_artifacts(flow: Dict[str, Any], transcriptions: Dict[str, Any], ai: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any], Dict[str, Any], Dict[str, Any], Dict[str, Any], Dict[str, Any], Dict[str, Any], Dict[str, Any]]:
    raw_actions = build_raw_actions(flow)
    pre_semantic_extract = build_pre_semantic_extract(raw_actions)
    ai_organizer = ai.get("organizer") if isinstance(ai.get("organizer"), dict) else {}
    if not ai_organizer:
        ai_organizer = deterministic_ai_organizer(flow)
    semantic_model = build_semantic_model(raw_actions, ai_organizer, transcriptions, flow)
    execution_model = build_execution_model(raw_actions, semantic_model, pre_semantic_extract)
    semantic_model["executionModel"] = execution_model
    human_routes = build_human_routes(raw_actions, pre_semantic_extract, ai_organizer, semantic_model)
    navigation_story = build_navigation_story(raw_actions, pre_semantic_extract, ai_organizer, human_routes, semantic_model)
    visual_blocks = build_visual_blocks(navigation_story, semantic_model, ai_organizer)
    display_nodes = build_display_nodes(navigation_story, semantic_model, ai_organizer)
    drawio_plan = build_drawio_plan(raw_actions, pre_semantic_extract, ai_organizer, human_routes, semantic_model, navigation_story, visual_blocks, execution_model)
    planned_flow = {
        **flow,
        "rawActions": raw_actions,
        "preSemanticExtract": pre_semantic_extract,
        "executionModel": execution_model,
        "aiOrganizer": ai_organizer,
        "semanticModel": semantic_model,
        "humanRoutes": human_routes,
        "semanticRoutes": human_routes,
        "navigationStory": navigation_story,
        "visualBlocks": visual_blocks,
        "businessBlocks": visual_blocks,
        "displayNodes": display_nodes,
        "drawioPlan": drawio_plan,
    }
    return raw_actions, pre_semantic_extract, ai_organizer, semantic_model, human_routes, navigation_story, display_nodes, drawio_plan, planned_flow


def build_prompts_detected(flow: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "items": [
            {
                "fileName": prompt.get("fileName", ""),
                "fullPath": prompt.get("fullPath", ""),
                "sourceActionId": prompt.get("sourceActionId", ""),
                "transcription": prompt.get("transcription", ""),
            }
            for prompt in flow.get("prompts", [])
            if isinstance(prompt, dict)
        ]
    }


def build_audio_matching(flow: Dict[str, Any], transcriptions: Dict[str, Any]) -> Dict[str, Any]:
    prompts = [prompt for prompt in flow.get("prompts", []) if isinstance(prompt, dict)]
    items = [item for item in transcriptions.get("items", []) if isinstance(item, dict)]
    by_name = {clean_text(item.get("fileName")).lower(): item for item in items if clean_text(item.get("fileName"))}
    prompt_names = {clean_text(prompt.get("fileName")).lower() for prompt in prompts if clean_text(prompt.get("fileName"))}
    matched = []
    for prompt in prompts:
        name = clean_text(prompt.get("fileName")).lower()
        audio = by_name.get(name)
        matched.append(
            {
                "fileName": prompt.get("fileName", ""),
                "sourceActionId": prompt.get("sourceActionId", ""),
                "status": "matched_transcribed" if audio and audio.get("status") == "transcribed" else "matched_failed" if audio else "missing_audio",
                "transcription": clean_text((audio or {}).get("rawTranscription") or prompt.get("transcription")),
            }
        )
    for item in items:
        name = clean_text(item.get("fileName")).lower()
        if name and name not in prompt_names:
            matched.append(
                {
                    "fileName": item.get("fileName", ""),
                    "sourceActionId": "",
                    "status": "unused_audio",
                    "transcription": clean_text(item.get("rawTranscription")),
                }
            )
    return {
        "items": matched,
        "summary": {
            "prompts": len(prompts),
            "audioFiles": len(items),
            "matched": len([item for item in matched if clean_text(item.get("status")).startswith("matched")]),
            "missingAudio": len([item for item in matched if item.get("status") == "missing_audio"]),
            "unusedAudio": len([item for item in matched if item.get("status") == "unused_audio"]),
        },
    }


def build_markdown(flow: Dict[str, Any], transcriptions: Dict[str, Any], ai: Dict[str, Any]) -> str:
    project = flow.get("project", {})
    rows = semantic_rows(flow)
    prompt_index = prompt_index_by_action(flow)
    menus = [action for action in flow.get("actions", []) if isinstance(action, dict) and clean_text(action.get("type")).upper() == "MENU"]
    rules = [action for action in flow.get("actions", []) if isinstance(action, dict) and clean_text(action.get("type")).upper() == "IF"]
    integrations = [
        action
        for action in flow.get("actions", [])
        if isinstance(action, dict) and clean_text(action.get("type")).upper() in {"RUNSCRIPT", "RUNSUB", "REST_API", "REQAGENT"}
    ]
    lines = [
        f"# Documentacao URA - {project.get('name', 'URA')}",
        "",
        "## Resumo executivo",
        ai.get("executiveSummary") or ai.get("functionalOverview") or "Resumo executivo nao gerado.",
        "",
        "## Dados extraidos do NICE",
        f"- Actions: {len(flow.get('actions', []))}",
        f"- Menus: {len(flow.get('menus', []))}",
        f"- Skills: {len(flow.get('skills', []))}",
        f"- Prompts: {len(flow.get('prompts', []))}",
        "",
        "## Jornada funcional",
    ]
    for menu in menus[:12]:
        lines.append(f"### Menu ActionID {menu.get('actionId')} - {menu.get('caption') or 'Menu'}")
        variable = menu_variable(menu.get("parameters"))
        if variable:
            lines.append(f"- Variavel capturada: `{variable}`")
        audio_lines = action_audio_text(menu, prompt_index, 160)
        if audio_lines:
            lines.append(f"- Audio/menu: {audio_lines}")
        options = menu_option_rows(menu, ai, rows)
        if options:
            for option in options[:16]:
                related = route_rows_for_option(option, rows)
                label = clean_text(option.get("label") or "Opcao")
                target = clean_text(option.get("target"))
                lines.append(f"- Opcao `{option.get('digit') or '-'}`: {label}" + (f" -> ActionID {target}" if target else ""))
                for item in related[:4]:
                    details = []
                    if item.get("audio"):
                        details.append(f"audio `{item.get('audio')}`")
                    if item.get("nextStep"):
                        details.append(f"next step `{item.get('nextStep')}`")
                    if item.get("skillName") or item.get("skillId"):
                        details.append(f"skill `{item.get('skillName') or item.get('skillId')}`")
                    if item.get("scriptpoint"):
                        details.append(f"scriptpoint `{item.get('scriptpoint')}`")
                    if details:
                        lines.append("  - " + "; ".join(details))
        lines.append("")
    lines.extend(
        [
            "## Regras IF",
        ]
    )
    for action in rules[:40]:
        expression = action_code(action)
        lines.append(f"- ActionID {action.get('actionId')} - {action.get('caption') or 'IF'}: `{short_label(expression, 220)}`")
    lines.extend(["", "## Integracoes e transferencias"])
    for action in integrations[:40]:
        details = action_semantic_details(action, rows, prompt_index)
        lines.append(f"- ActionID {action.get('actionId')} - {action.get('type')} - {action.get('caption') or ''}")
        for detail in details[:4]:
            lines.append(f"  - {detail}")
    lines.extend(
        [
            "",
            "## Scriptpoints e mapa_dna",
        ]
    )
    for item in [row for row in rows if row.get("scriptpoint") or row.get("mapaDna")][:80]:
        lines.append(
            f"- ActionID {item.get('sourceActionId')}: scriptpoint `{item.get('scriptpoint') or '-'}`, mapa_dna `{item.get('mapaDna') or '-'}`, destino `{item.get('nextStep') or item.get('skillName') or item.get('transferCode') or '-'}`"
        )
    lines.extend(
        [
            "",
            "## Prompts e transcricoes",
        ]
    )
    by_name = {item.get("fileName"): item for item in transcriptions.get("items", [])}
    for prompt in flow.get("prompts", []):
        trx = by_name.get(prompt.get("fileName"), {})
        lines.append(f"- `{prompt.get('fileName')}`: {trx.get('rawTranscription') or prompt.get('transcription') or 'sem transcricao'}")
    lines.extend(["", "## Analises geradas por IA"])
    lines.append(ai.get("businessSummary") or "IA indisponivel ou sem resumo.")
    lines.extend(["", "## Inconsistencias"])
    for issue in ai.get("issues", []):
        lines.append(f"- **{issue.get('severity', 'info')}** {issue.get('title', '')}: {issue.get('description', '')}")
    lines.extend(["", "## Plano de testes"])
    for case in ai.get("testCases", []):
        lines.append(f"- {case.get('id', '')} - {case.get('title', '')}: {case.get('expectedResult', '')}")
    lines.extend(["", "## Runbook de sustentacao"])
    for item in ai.get("runbook", []):
        lines.append(f"- {item.get('problem', '')}: {item.get('whereToCheck', '')}")
    return "\n".join(lines) + "\n"


def build_html(markdown: str) -> str:
    body = []
    for line in markdown.splitlines():
        if line.startswith("# "):
            body.append(f"<h1>{html.escape(line[2:])}</h1>")
        elif line.startswith("## "):
            body.append(f"<h2>{html.escape(line[3:])}</h2>")
        elif line.startswith("- "):
            body.append(f"<li>{html.escape(line[2:])}</li>")
        elif line.strip():
            body.append(f"<p>{html.escape(line)}</p>")
    return (
        "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\" />"
        "<title>Documentacao URA</title><style>body{font-family:Inter,Arial,sans-serif;max-width:1100px;margin:40px auto;line-height:1.55;color:#18181b}h1,h2{color:#991b1b}li{margin:6px 0}code{background:#f4f4f5;padding:2px 5px;border-radius:4px}</style></head><body>"
        + "\n".join(body)
        + "</body></html>"
    )


def encode_file(content: bytes) -> str:
    return base64.b64encode(content).decode("ascii")


def package_files(files: Dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buffer.getvalue()


@app.get("/ura-docs/health")
def health():
    return {
        "ok": True,
        "service": "ura-docs",
        "parser": URA_DOCS_PARSER_NAME,
        "parserVersion": URA_DOCS_PARSER_VERSION,
        "checkedAt": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/parse")
async def parse(file: UploadFile = File(...)):
    data = await file.read()
    try:
        payload = parse_source_text(decode_upload(data))
        return {"normalized_flow": normalize_flow(payload, file.filename or "URA")}
    except ET.ParseError as error:
        raise HTTPException(status_code=400, detail=f"XML NICE invalido: {error}") from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/generate-drawio")
async def generate_drawio(request: PackageRequest):
    validate_package_flow(request.normalized_flow)
    planned_flow = build_processing_artifacts(request.normalized_flow, request.transcriptions or {}, request.ai_enrichment or {})[8]
    drawio = build_drawio(planned_flow, request.ai_enrichment)
    return {"fileName": "fluxo_ura.drawio", "contentBase64": encode_file(drawio.encode("utf-8"))}


@app.post("/generate-package")
async def generate_package(request: PackageRequest):
    flow = request.normalized_flow
    validate_package_flow(flow)
    transcriptions = request.transcriptions or {}
    ai = request.ai_enrichment or {}
    raw_actions, pre_semantic_extract, ai_organizer, semantic_model, human_routes, navigation_story, display_nodes, drawio_plan, planned_flow = build_processing_artifacts(flow, transcriptions, ai)
    prompts_detected = build_prompts_detected(planned_flow)
    audio_matching = build_audio_matching(planned_flow, transcriptions)
    drawio = build_drawio(planned_flow, ai)
    md = build_markdown(planned_flow, transcriptions, ai)
    html_doc = build_html(md)

    route_rows = []
    for index, row in enumerate(semantic_rows(flow), start=1):
        route_rows.append(
            {
                **row,
                "company": row.get("category") or flow.get("project", {}).get("name") or "Fluxo",
                "dtmf": ", ".join(row.get("caseValues") or []) or str(index),
                "actionId": row.get("sourceActionId"),
                "audioText": row.get("audio"),
            }
        )
    menus_csv = csv_text(
        ["empresa", "dtmf", "categoria", "tratamento", "actionId", "skillId", "skillName", "confidence", "audioFala"],
        [
            [
                row.get("company"),
                row.get("dtmf"),
                row.get("category"),
                row.get("treatment"),
                row.get("actionId"),
                row.get("skillId"),
                row.get("skillName"),
                row.get("confidence"),
                row.get("audioText"),
            ]
            for row in route_rows
        ],
    )
    skills_csv = csv_text(
        ["empresa", "ramoAssunto", "skillId", "skillName", "actionId", "confidence"],
        [
            [
                row.get("company"),
                row.get("treatment") or row.get("category"),
                row.get("skillId"),
                row.get("skillName"),
                row.get("actionId"),
                row.get("confidence"),
            ]
            for row in route_rows
            if row.get("skillId") or row.get("skillName")
        ],
    )
    transfers_csv = csv_text(["id", "name", "sourceActionId", "sourceActionCaption", "nextStep"], [[s.get("id"), s.get("name"), s.get("sourceActionId"), s.get("sourceActionCaption"), s.get("nextStep")] for s in flow.get("transferCodes", [])])
    prompts_csv = csv_text(["fileName", "fullPath", "sourceActionId", "matchedAudio", "transcription"], [[p.get("fileName"), p.get("fullPath"), p.get("sourceActionId"), p.get("matchedAudio"), p.get("transcription")] for p in flow.get("prompts", [])])
    cdr_csv = csv_text(["variable"], [[v] for v in flow.get("cdrVariables", [])])
    tests_csv = csv_text(["id", "title", "expectedResult", "priority", "evidence"], [[c.get("id"), c.get("title"), c.get("expectedResult"), c.get("priority"), "; ".join(c.get("evidence", []))] for c in ai.get("testCases", [])])
    runbook_csv = csv_text(["problem", "whereToCheck", "technicalCheck", "businessImpact"], [[r.get("problem"), r.get("whereToCheck"), r.get("technicalCheck"), r.get("businessImpact")] for r in ai.get("runbook", [])])
    validations_csv = csv_text(["actionId", "caption", "type"], [[v.get("actionId"), v.get("caption"), v.get("type")] for v in flow.get("validations", [])])
    technical_csv = csv_text(
        ["actionId", "type", "caption", "defaultNextAction", "branches", "cases"],
        [
            [
                action.get("actionId"),
                action.get("type"),
                action.get("caption"),
                action.get("defaultNextAction"),
                "; ".join(f"{branch.get('name')}->{branch.get('target')}" for branch in action.get("branches", []) if isinstance(branch, dict)),
                "; ".join(f"{case.get('value')}->{case.get('target')}" for case in action.get("cases", []) if isinstance(case, dict)),
            ]
            for action in flow.get("actions", [])
            if isinstance(action, dict)
        ],
    )

    files = {
        "fluxo_ura.drawio": drawio.encode("utf-8"),
        "documentacao_ura.html": html_doc.encode("utf-8"),
        "documentacao_ura.md": md.encode("utf-8"),
        "01_raw_actions.json": json.dumps(raw_actions, ensure_ascii=False, indent=2).encode("utf-8"),
        "02_pre_semantic_extract.json": json.dumps(pre_semantic_extract, ensure_ascii=False, indent=2).encode("utf-8"),
        "03_ai_organizer.json": json.dumps(ai_organizer, ensure_ascii=False, indent=2).encode("utf-8"),
        "03_execution_model.json": json.dumps(planned_flow.get("executionModel", {}), ensure_ascii=False, indent=2).encode("utf-8"),
        "04_human_routes.json": json.dumps(human_routes, ensure_ascii=False, indent=2).encode("utf-8"),
        "navigation_story.json": json.dumps(navigation_story, ensure_ascii=False, indent=2).encode("utf-8"),
        "display_nodes.json": json.dumps(display_nodes, ensure_ascii=False, indent=2).encode("utf-8"),
        "05_drawio_plan.json": json.dumps(drawio_plan, ensure_ascii=False, indent=2).encode("utf-8"),
        "prompts_detected.json": json.dumps(prompts_detected, ensure_ascii=False, indent=2).encode("utf-8"),
        "audio_matching.json": json.dumps(audio_matching, ensure_ascii=False, indent=2).encode("utf-8"),
        "normalized_flow.json": json.dumps(flow, ensure_ascii=False, indent=2).encode("utf-8"),
        "transcricoes.json": json.dumps(transcriptions, ensure_ascii=False, indent=2).encode("utf-8"),
        "ai_enrichment.json": json.dumps(ai, ensure_ascii=False, indent=2).encode("utf-8"),
        "matriz_menus.csv": menus_csv.encode("utf-8-sig"),
        "matriz_skills.csv": skills_csv.encode("utf-8-sig"),
        "matriz_transferencias.csv": transfers_csv.encode("utf-8-sig"),
        "matriz_prompts.csv": prompts_csv.encode("utf-8-sig"),
        "matriz_cdr.csv": cdr_csv.encode("utf-8-sig"),
        "matriz_tecnica.csv": technical_csv.encode("utf-8-sig"),
        "plano_testes.csv": tests_csv.encode("utf-8-sig"),
        "runbook.csv": runbook_csv.encode("utf-8-sig"),
        "validacoes.csv": validations_csv.encode("utf-8-sig"),
    }
    files["documentacao_ura.zip"] = package_files(files)
    return {
        "summary": {
            "files": len(files),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "semanticRoutes": len(human_routes.get("routes", [])),
            "drawioPages": len(drawio_plan.get("pages", [])),
            "promptsDetected": len(prompts_detected.get("items", [])),
            "promptsTranscribed": len([item for item in audio_matching.get("items", []) if item.get("status") == "matched_transcribed"]),
        },
        "files": {
            name: {"fileName": name, "contentBase64": encode_file(content)}
            for name, content in files.items()
        },
    }
