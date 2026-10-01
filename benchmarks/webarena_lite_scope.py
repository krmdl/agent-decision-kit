"""Safety checks for the read-only BrowserGym WebArena Lite runner."""
import re


SAFE_INTENT = re.compile(r"^(show|view|list|open|display|browse)\b", re.IGNORECASE)
MUTATING_INTENT = re.compile(
    r"\b(add|buy|cancel|change|checkout|create|delete|disable|edit|make|mark|modify|notify|order|post|purchase|remove|submit|update)\b",
    re.IGNORECASE,
)


def select_read_only_task(configs, old_task_id):
    matches = [item for item in configs if item.get("old_task_id") == old_task_id]
    if len(matches) != 1:
        raise ValueError(f"Expected one WebArena Lite task with old_task_id={old_task_id}; found {len(matches)}")

    item = matches[0]
    intent = str(item.get("intent", "")).strip()
    evaluator = item.get("eval") or {}
    eval_types = evaluator.get("eval_types", [])
    if item.get("sites") != ["shopping_admin"]:
        raise ValueError("This runner only accepts tasks for the isolated shopping_admin site")
    if item.get("require_reset"):
        raise ValueError("This runner refuses tasks that require a benchmark-wide environment reset")
    if eval_types != ["url_match"]:
        raise ValueError("This runner only accepts read-only URL-navigation tasks")
    if not SAFE_INTENT.search(intent) or MUTATING_INTENT.search(intent):
        raise ValueError("This runner refuses task instructions that do not clearly describe read-only navigation")

    # Keep evaluator details such as reference URLs and answers out of the runner record.
    return {
        "oldTaskId": old_task_id,
        "intentTemplateId": item.get("intent_template_id"),
        "intent": intent,
        "sites": ["shopping_admin"],
    }
