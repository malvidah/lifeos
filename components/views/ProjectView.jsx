"use client";
import { useState, useEffect, useRef, useCallback, useMemo, Fragment, createContext, useContext } from "react";
import { useTheme } from "@/lib/theme";
import { mono, F, R, projectColor, CHIP_TOKENS } from "@/lib/tokens";
import { toKey, todayKey, shift, fmtDate, MONTHS_SHORT, DAYS_SHORT } from "@/lib/dates";
import { extractTags, tagDisplayName } from "@/lib/tags";
import { useDbSave, dbLoad } from "@/lib/db";
import { useNavigation, useProjectNames, NoteContext } from "@/lib/contexts";
import { Card, Widget, Ring, ChevronBtn, TagChip, RichLine } from "../ui/primitives.jsx";
import { DayLabEditor } from "../DayLabEditor.jsx";
import { TaskFilterBtns } from "../widgets/Tasks.jsx";
function EntryLine({ entry, date, editing, onStartEdit, onSave, dimTag }) {
  const { C } = useTheme();
export default function ProjectView({ project, token, userId, onBack, onSelectDate, taskFilter, setTaskFilter }) {
  const { C } = useTheme();
