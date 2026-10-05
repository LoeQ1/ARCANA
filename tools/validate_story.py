#!/usr/bin/env python3
"""Validate ARCANA's JSON story graph and its supported rules."""

import json
import sys
from pathlib import Path

CONDITIONS = {"flagEquals", "levelAtLeast", "hasItem", "questStatus", "locationIs"}
EFFECTS = {"setFlag", "startQuest", "advanceQuest", "completeQuest", "grantItem", "removeItem", "grantXp", "grantGold", "unlockLocation", "changeRelation"}


def validate(story, gameplay=None):
    errors = []
    if not isinstance(story, dict):
        return ["story root must be an object"]
    if not isinstance(story.get("storyId"), str) or not story["storyId"].strip():
        errors.append("storyId must be a non-empty string")
    if not isinstance(story.get("version"), int) or story["version"] < 1:
        errors.append("version must be a positive integer")
    nodes = story.get("nodes")
    if not isinstance(nodes, dict) or not nodes:
        return errors + ["nodes must be a non-empty object"]
    start = story.get("startNode")
    if start not in nodes:
        errors.append(f"startNode '{start}' does not exist")

    def check_rules(rules, allowed, label):
        if not isinstance(rules, list):
            errors.append(f"{label} must be an array")
            return
        for index, rule in enumerate(rules):
            if not isinstance(rule, dict) or rule.get("type") not in allowed:
                errors.append(f"{label}[{index}] has an unknown rule type")
                continue
            kind = rule["type"]
            required = {
                "flagEquals": ("key", "value"), "levelAtLeast": ("value",),
                "hasItem": ("itemId",), "questStatus": ("questId", "status"),
                "locationIs": ("location",), "setFlag": ("key", "value"),
                "startQuest": ("questId",), "advanceQuest": ("questId", "step"),
                "completeQuest": ("questId",), "grantItem": ("itemId", "quantity"),
                "removeItem": ("itemId", "quantity"), "grantXp": ("amount",),
                "grantGold": ("amount",), "unlockLocation": ("location",),
                "changeRelation": ("npcId", "amount"),
            }[kind]
            for field in required:
                if field not in rule:
                    errors.append(f"{label}[{index}] ({kind}) is missing '{field}'")
            for field in ("quantity", "amount"):
                if field in rule and (not isinstance(rule[field], int) or rule[field] < 0):
                    errors.append(f"{label}[{index}].{field} must be a non-negative integer")
            if gameplay is not None:
                references = {
                    "hasItem": ("items", "itemId"), "grantItem": ("items", "itemId"), "removeItem": ("items", "itemId"),
                    "questStatus": ("quests", "questId"), "startQuest": ("quests", "questId"),
                    "advanceQuest": ("quests", "questId"), "completeQuest": ("quests", "questId"),
                    "locationIs": ("locations", "location"), "unlockLocation": ("locations", "location"),
                }.get(kind)
                if references:
                    collection, field = references
                    if rule.get(field) not in gameplay.get(collection, {}):
                        errors.append(f"{label}[{index}] references unknown {collection[:-1]} '{rule.get(field)}'")

    graph = {node_id: [] for node_id in nodes}
    seen_global_choices = set()
    for node_id, node in nodes.items():
        if not isinstance(node, dict):
            errors.append(f"node '{node_id}' must be an object")
            continue
        for required in ("title", "text", "choices"):
            if required not in node:
                errors.append(f"node '{node_id}' is missing '{required}'")
        if not isinstance(node.get("title"), str) or not isinstance(node.get("text"), str):
            errors.append(f"node '{node_id}' title and text must be strings")
        check_rules(node.get("conditions", []), CONDITIONS, f"{node_id}.conditions")
        choices = node.get("choices")
        if not isinstance(choices, list):
            continue
        local_ids = set()
        for choice in choices:
            if not isinstance(choice, dict):
                errors.append(f"node '{node_id}' has a non-object choice")
                continue
            choice_id = choice.get("id")
            if not isinstance(choice_id, str) or not choice_id:
                errors.append(f"node '{node_id}' has a choice without an id")
            elif choice_id in local_ids:
                errors.append(f"node '{node_id}' has duplicate choice id '{choice_id}'")
            local_ids.add(choice_id)
            qualified_id = (node_id, choice_id)
            if qualified_id in seen_global_choices:
                errors.append(f"duplicate choice '{node_id}.{choice_id}'")
            seen_global_choices.add(qualified_id)
            if not isinstance(choice.get("text"), str):
                errors.append(f"choice '{node_id}.{choice_id}' text must be a string")
            check_rules(choice.get("conditions", []), CONDITIONS, f"{node_id}.{choice_id}.conditions")
            check_rules(choice.get("effects", []), EFFECTS, f"{node_id}.{choice_id}.effects")
            target = choice.get("next")
            if target is not None:
                if target not in nodes:
                    errors.append(f"choice '{node_id}.{choice_id}' points to missing node '{target}'")
                else:
                    graph[node_id].append(target)

    reachable = set()
    pending = [start] if start in nodes else []
    while pending:
        current = pending.pop()
        if current in reachable:
            continue
        reachable.add(current)
        pending.extend(graph.get(current, []))
    for node_id in nodes:
        if node_id not in reachable:
            errors.append(f"node '{node_id}' is unreachable from startNode")
    return errors


def main():
    root = Path(__file__).parents[1]
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "content/story/arrival.json"
    gameplay_path = root / "content/data/gameplay.json"
    try:
        def reject_duplicate_keys(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError(f"duplicate JSON key: {key}")
                result[key] = value
            return result

        story = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys)
        gameplay = json.loads(gameplay_path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys)
    except (OSError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2
    errors = validate(story, gameplay)
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print(f"OK: {story['storyId']} v{story['version']} ({len(story['nodes'])} nodes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
