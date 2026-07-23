"""The graph package facade must expose the full pre-split module surface.

``services/graph.py`` was split into domain modules (core/projects/tasks/labels/
cycles/identities/goals) with ``graph/__init__.py`` re-exporting everything.
Every caller uses ``from app.services import graph`` + ``graph.X``; this test
pins the entire public surface (plus the private helpers tests and cross-module
callers rely on) so a module shuffle can never silently drop a name.
"""

from app.services import graph

# Snapshot of the pre-split module's API (constants, views, functions, and the
# private helpers used across modules or by tests/factories).
EXPECTED_NAMES = [
    # constants
    "NODE_PROJECT",
    "NODE_TASK",
    "NODE_IDENTITY",
    "NODE_GOAL",
    "NODE_CYCLE",
    "NODE_LABEL",
    "REL_CONTAINS",
    "REL_MEMBER_OF",
    "REL_ASSIGNED_TO",
    "REL_DEPENDS_ON",
    "REL_LABELED",
    "REL_IN_CYCLE",
    # views
    "CycleView",
    "GoalView",
    "IdentityView",
    "LabelView",
    "ProjectView",
    "TaskView",
    # private helpers with external/cross-module consumers
    "_TASK_DATA_SCALARS",
    "_TASK_HOT_COLUMNS",
    "_apply_task_data_defaults",
    "_apply_task_fields",
    "_containment_ids_map",
    "_cycle_view",
    "_delete_task_node",
    "_goal_view",
    "_identity_view",
    "_iso",
    "_label_view",
    "_log_event",
    "_parse_dt",
    "_project_view",
    # core
    "container_type_keys",
    "task_type_keys",
    "create_node",
    "get_node",
    "ensure_node",
    "update_node",
    "delete_node",
    "add_edge",
    "remove_edge",
    "remove_edges",
    "neighbors",
    "children_of",
    "parents_of",
    "ancestors_of",
    "nearest_ancestor_of_type",
    "descendants_of",
    "detect_cycle",
    "prerequisite_ids",
    "dependent_ids",
    "dependency_maps",
    "project_container_map",
    # labels
    "set_label",
    "unset_label",
    "label_ids_for_task",
    "labeled_ids_map",
    "label_project_map",
    "create_label",
    "update_label",
    "delete_label",
    "get_label",
    "labels_in_project",
    "find_label_by_name",
    "decisions",
    "labels_for_task",
    "labels_map",
    # cycles
    "add_to_cycle",
    "remove_from_cycle",
    "task_ids_in_cycle",
    "tasks_in_cycle",
    "cycle_ids_for_task",
    "cycle_project_map",
    "create_cycle",
    "update_cycle",
    "delete_cycle",
    "get_cycle",
    "cycles_in_project",
    "cycles_for_task",
    "find_cycle_by_name",
    # identities
    "link_membership",
    "unlink_membership",
    "project_ids_for_identity",
    "identity_ids_for_project",
    "projects_for_identity",
    "create_identity",
    "update_identity",
    "delete_identity",
    "get_identity",
    "all_identities",
    "find_identity_by_share_token",
    "identities_for_project",
    # goals
    "link_goal_project",
    "project_ids_for_goal",
    "projects_for_goal",
    "create_goal",
    "update_goal",
    "delete_goal",
    "get_goal",
    "all_goals",
    # projects
    "create_project",
    "update_project",
    "get_project",
    "all_projects",
    "projects_by_ids",
    "find_project_by_share_token",
    "search_projects",
    "contained_task_ids",
    "unfiled_task_ids",
    # tasks
    "member_project_ids",
    "member_container_ids",
    "task_view",
    "get_task",
    "task_views_by_ids",
    "task_views_for_ids",
    "create_task",
    "update_task",
    "find_task_by_callback_token",
    "find_task_by_external",
    "delete_task_tree",
    "delete_project_and_tasks",
    "set_parent_task",
    "project_id_of_task",
    "project_of_task",
    "parent_task_map",
    "project_ids_map",
    "container_ids_map",
    "tasks_in_project",
    "child_task_ids_map",
    "subtasks",
    "subtask_ids_among",
    "top_level_task_filter",
]


def test_facade_exposes_full_pre_split_surface():
    missing = [name for name in EXPECTED_NAMES if not hasattr(graph, name)]
    assert not missing, f"graph facade lost names: {missing}"


def test_no_duplicate_expected_names():
    assert len(EXPECTED_NAMES) == len(set(EXPECTED_NAMES))
