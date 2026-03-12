"use client";
import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { useTheme } from "@/lib/theme";
import { mono, F, R, projectColor } from "@/lib/tokens";
import { toKey, fmtDate, MONTHS_SHORT, DAYS_SHORT } from "@/lib/dates";
import { extractTags } from "@/lib/tags";
import { useNavigation } from "@/lib/contexts";
import { TagChip } from "../ui/primitives.jsx";
export function useSearch(query, token, userId) {
export function SearchResults({ results, loading, query, onSelectDate }) {
  const { C } = useTheme();
