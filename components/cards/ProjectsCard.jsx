"use client";
import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { useTheme } from "@/lib/theme";
import { mono, F, R, projectColor } from "@/lib/tokens";
import { toKey, todayKey, shift, fmtDate } from "@/lib/dates";
import { extractTags, extractTagsFromAll, tagDisplayName } from "@/lib/tags";
import { useNavigation } from "@/lib/contexts";
import { Card, Ring, TagChip } from "../ui/primitives.jsx";
import { TaskFilterBtns } from "../widgets/Tasks.jsx";
const TAGS_CACHE = { tags: null, connections: [], recency: {} };
export function MapCard({ allTags, connections, onSelectProject, token, userId, taskFilter, setTaskFilter }) {
  const { C } = useTheme();
export function ProjectsCard({ date, token, userId, onSelectProject }) {
  const { C } = useTheme();
