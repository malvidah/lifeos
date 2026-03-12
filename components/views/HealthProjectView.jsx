"use client";
import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { useTheme } from "@/lib/theme";
import { mono, F, R, projectColor } from "@/lib/tokens";
import { toKey, todayKey, shift, fmtDate, MONTHS_SHORT } from "@/lib/dates";
import { tagDisplayName } from "@/lib/tags";
import { Card, Widget, Ring, ChevronBtn } from "../ui/primitives.jsx";
import { fmtMins, sportEmoji } from "@/lib/formatting";
import HealthCard from "../cards/HealthCard.jsx";
function HealthAllMeals({ token, userId, onSelectDate, onBack }) {
  const { C } = useTheme();
function HealthAllActivities({ token, userId, onSelectDate, onBack }) {
  const { C } = useTheme();
export default function HealthProjectView({ token, userId, onBack, onHealthChange, onScoresReady, startSync, endSync, onSelectDate, taskFilter, setTaskFilter }) {
  const { C } = useTheme();
