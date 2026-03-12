"use client";
import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { useTheme } from "@/lib/theme";
import { mono, F, R, blurweb } from "@/lib/tokens";
import { toKey, todayKey, fmtDate } from "@/lib/dates";
import { dbLoad, dbSave } from "@/lib/db";
import { useIsMobile } from "@/lib/hooks";
import { DayLabLoader } from "../ui/primitives.jsx";
export function InsightsCard({date, token, userId, healthKey, collapsed, onToggle}) {
  const { C } = useTheme();
export default function ChatFloat({date, token, userId, healthKey, theme}) {
  const { C } = useTheme();
