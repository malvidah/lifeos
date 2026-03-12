"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTheme } from "@/lib/theme";
import { mono, F, R } from "@/lib/tokens";
import { toKey, todayKey, shift, dayOffset, offsetToDate, keyToDayNum, MONTHS_FULL, MONTHS_SHORT, DAYS_SHORT } from "@/lib/dates";
import { useIsMobile } from "@/lib/hooks";
import { Card, NavBtn, ChevronBtn } from "../ui/primitives.jsx";
function MonthView({ initYear, initMonth, selected, onSelectDay, onMonthChange, healthDots, events, token }) {
  const { C } = useTheme();
function MobileCalPicker({selected, onSelect, events, healthDots={}, desktop=false, onEventClick, onAddClick, collapsed, onToggle, calView='day', onCalViewChange}) {
  const { C } = useTheme();
export default function CalendarCard({selected, onSelect, events, setEvents, healthDots, token, collapsed, onToggle, calView, onCalViewChange}) {
  const { C } = useTheme();
