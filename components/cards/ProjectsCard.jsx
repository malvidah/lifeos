"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { mono, F, projectColor, CHIP_TOKENS } from "@/lib/tokens";
import { api } from "@/lib/api";

const GOAL_COLOR = "#5BA89D";

export default function ProjectsCard({ token, date, onSelectDate }) {
  const [view, setView] = useState("kanban"); // 'kanban' | 'goal-detail' | 'project-detail'
  const [goals, setGoals] = useState([]);
  const [selectedGoal, setSelectedGoal] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState(null);
  const [editText, setEditText] = useState("");
  const [newGoalProject, setNewGoalProject] = useState(null);
  const [newGoalText, setNewGoalText] = useState("");

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const res = await api.get("/api/goals", token);
    if (res?.goals) {
      setGoals(res.goals);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    refresh();
  }, [token, refresh]);

  useEffect(() => {
    const handleGoalsChanged = () => refresh();
    const handleTasksSaved = () => refresh();

    window.addEventListener("daylab:goals-changed", handleGoalsChanged);
    window.addEventListener("daylab:tasks-saved", handleTasksSaved);

    return () => {
      window.removeEventListener("daylab:goals-changed", handleGoalsChanged);
      window.removeEventListener("daylab:tasks-saved", handleTasksSaved);
    };
  }, [refresh]);

  const saveGoalName = async (id, newName) => {
    if (!newName.trim()) {
      setEditingGoalId(null);
      return;
    }
    await api.patch("/api/goals", { id, name: newName.trim() }, token);
    setEditingGoalId(null);
    refresh();
    window.dispatchEvent(new Event("daylab:goals-changed"));
  };

  const createGoal = async (name, project) => {
    if (!name.trim()) return;
    await api.post("/api/goals", { name, project }, token);
    setNewGoalText("");
    refresh();
    window.dispatchEvent(new Event("daylab:goals-changed"));
  };

  const toggleGoalDone = async (goal) => {
    await api.patch("/api/goals", { id: goal.id, done: !goal.done }, token);
    refresh();
    window.dispatchEvent(new Event("daylab:goals-changed"));
  };

  const groupedGoals = goals.reduce((acc, goal) => {
    const project = goal.project || "Unassigned";
    if (!acc[project]) acc[project] = [];
    acc[project].push(goal);
    return acc;
  }, {});

  const projectNames = Object.keys(groupedGoals).sort();

  // ─── Kanban View ────────────────────────────────────────────────────────────
  if (view === "kanban") {
    return (
      <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>
        {/* Empty state */}
        {goals.length === 0 && !loading && (
          <div style={{ padding: "16px 0", color: "var(--dl-middle)", fontFamily: mono, fontSize: "12px", letterSpacing: "0.04em" }}>
            No goals yet. Tag a task or habit with <span style={{ color: GOAL_COLOR }}>/g</span> to create one.
          </div>
        )}

        {/* Kanban Grid */}
        <div style={{ display: "flex", overflowX: "auto", gap: "12px", paddingBottom: "8px" }}>
          {projectNames.map((project) => (
            <div
              key={project}
              style={{
                minWidth: "200px",
                maxWidth: "260px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              {/* Column Header */}
              <div
                onClick={() => {
                  setSelectedProject(project);
                  setView("project-detail");
                }}
                style={{
                  fontSize: "12px",
                  fontFamily: mono,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: projectColor(project),
                  cursor: "pointer",
                  paddingBottom: "4px",
                  borderBottom: `1px solid ${projectColor(project)}22`,
                }}
              >
                {project}
              </div>

              {/* Goal Cards */}
              {groupedGoals[project].map((goal) => (
                <div
                  key={goal.id}
                  onClick={() => {
                    setSelectedGoal(goal);
                    setView("goal-detail");
                  }}
                  style={{
                    border: "1px solid var(--dl-border)",
                    borderRadius: "10px",
                    padding: "10px 12px",
                    cursor: "pointer",
                    transition: "opacity 0.15s",
                    opacity: goal.done ? 0.5 : 1,
                  }}
                >
                  {/* Goal Name */}
                  {editingGoalId === goal.id ? (
                    <input
                      autoFocus
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onBlur={() => saveGoalName(goal.id, editText)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.target.blur();
                        if (e.key === "Escape") setEditingGoalId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        background: "transparent",
                        border: "none",
                        outline: "none",
                        fontFamily: mono,
                        fontSize: "12px",
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: GOAL_COLOR,
                        width: "100%",
                        padding: 0,
                        margin: 0,
                        textDecoration: goal.done ? "line-through" : "none",
                      }}
                    />
                  ) : (
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingGoalId(goal.id);
                        setEditText(goal.name);
                      }}
                      style={{
                        fontSize: "12px",
                        fontFamily: mono,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: GOAL_COLOR,
                        cursor: "text",
                        textDecoration: goal.done ? "line-through" : "none",
                      }}
                    >
                      {goal.name}
                    </div>
                  )}

                  {/* Meta */}
                  <div style={{ fontSize: "11px", color: "var(--dl-middle)", marginTop: "4px" }}>
                    {goal.habit_count} habits · {goal.task_count} tasks
                  </div>
                </div>
              ))}

              {/* New Goal Input */}
              <input
                placeholder="New goal..."
                value={newGoalProject === project ? newGoalText : ""}
                onChange={(e) => {
                  setNewGoalProject(project);
                  setNewGoalText(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    createGoal(newGoalText, project);
                    setNewGoalProject(null);
                    setNewGoalText("");
                  }
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  fontFamily: mono,
                  fontSize: "12px",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--dl-middle)",
                  padding: "10px 0",
                  cursor: "text",
                  marginTop: "4px",
                }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ─── Goal Detail View ───────────────────────────────────────────────────────
  if (view === "goal-detail" && selectedGoal) {
    const goal = goals.find((g) => g.id === selectedGoal.id) || selectedGoal;

    return (
      <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>
        {/* Back Button */}
        <button
          onClick={() => {
            setView("kanban");
            setSelectedGoal(null);
          }}
          style={{
            background: "none",
            border: "none",
            padding: "0",
            fontSize: "12px",
            fontFamily: mono,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--dl-middle)",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          ← GOALS
        </button>

        {/* Goal Name */}
        {editingGoalId === goal.id ? (
          <input
            autoFocus
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={() => saveGoalName(goal.id, editText)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.target.blur();
              if (e.key === "Escape") setEditingGoalId(null);
            }}
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              fontFamily: mono,
              fontSize: "14px",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: GOAL_COLOR,
              width: "100%",
              padding: 0,
              margin: 0,
              marginBottom: "8px",
            }}
          />
        ) : (
          <div
            onClick={() => {
              setEditingGoalId(goal.id);
              setEditText(goal.name);
            }}
            style={{
              fontSize: "14px",
              fontFamily: mono,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: GOAL_COLOR,
              cursor: "text",
              marginBottom: "8px",
            }}
          >
            {goal.name}
          </div>
        )}

        {/* Project Chip */}
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <div
            onClick={() => {
              setSelectedProject(goal.project || "Unassigned");
              setView("project-detail");
            }}
            style={{
              ...CHIP_TOKENS.project(projectColor(goal.project || "Unassigned")),
              cursor: "pointer",
            }}
          >
            {(goal.project || "Unassigned").toUpperCase()}
          </div>
        </div>

        {/* Meta */}
        <div style={{ fontSize: "12px", color: "var(--dl-middle)" }}>
          {goal.habit_count} linked habits · {goal.task_count} linked tasks
        </div>

        {/* Done Toggle */}
        <button
          onClick={() => toggleGoalDone(goal)}
          style={{
            background: goal.done ? "var(--dl-accent)" : "var(--dl-surface)",
            border: `1px solid ${goal.done ? "var(--dl-accent)" : "var(--dl-border)"}`,
            borderRadius: "8px",
            padding: "8px 12px",
            fontSize: "11px",
            fontFamily: mono,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: goal.done ? "white" : "var(--dl-strong)",
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          {goal.done ? "✓ DONE" : "MARK DONE"}
        </button>
      </div>
    );
  }

  // ─── Project Detail View ────────────────────────────────────────────────────
  if (view === "project-detail" && selectedProject) {
    const projectGoals = groupedGoals[selectedProject] || [];

    return (
      <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>
        {/* Back Button */}
        <button
          onClick={() => {
            setView("kanban");
            setSelectedProject(null);
          }}
          style={{
            background: "none",
            border: "none",
            padding: "0",
            fontSize: "12px",
            fontFamily: mono,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--dl-middle)",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          ← PROJECTS
        </button>

        {/* Project Name */}
        <div
          style={{
            fontSize: "14px",
            fontFamily: mono,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: projectColor(selectedProject),
          }}
        >
          {selectedProject}
        </div>

        {/* Goal Count Summary */}
        <div style={{ fontSize: "11px", color: "var(--dl-middle)" }}>
          {projectGoals.length} goal{projectGoals.length !== 1 ? "s" : ""}
        </div>

        {/* Goals List */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {projectGoals.map((goal) => (
            <div
              key={goal.id}
              onClick={() => {
                setSelectedGoal(goal);
                setView("goal-detail");
              }}
              style={{
                border: "1px solid var(--dl-border)",
                borderRadius: "10px",
                padding: "10px 12px",
                cursor: "pointer",
                transition: "opacity 0.15s",
                opacity: goal.done ? 0.5 : 1,
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  fontFamily: mono,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: GOAL_COLOR,
                  textDecoration: goal.done ? "line-through" : "none",
                }}
              >
                {goal.name}
              </div>
              <div style={{ fontSize: "11px", color: "var(--dl-middle)", marginTop: "4px" }}>
                {goal.habit_count} habits · {goal.task_count} tasks
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}
