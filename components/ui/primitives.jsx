"use client";
import { useState, useEffect, useRef, Fragment } from "react";
import { useTheme } from "@/lib/theme";
import { mono, F, R, projectColor, CHIP_TOKENS } from "@/lib/tokens";
import { useNavigation } from "@/lib/contexts";

export function ChevronBtn({collapsed, onToggle, style={}}) {
  const { C } = useTheme();

export function Ring({score,color,size=48}) {
  const { C } = useTheme();

export function Card({children,style={},fitContent=false}) {
  const { C } = useTheme();

export function Widget({label,color,children,slim,collapsed,onToggle,headerRight,headerLeft,autoHeight}) {
  const { C } = useTheme();

export function InfoTip({text}) {
  const { C } = useTheme();

export function IntegrationToggle({on, onOn, onOff, pending}) {
  const { C } = useTheme();

export function IntegrationRow({label, subtitle, connected, onToggleOn, onToggleOff, children, pendingToggle}) {
  const { C } = useTheme();

export function Shimmer({width="100%", height=14, style={}}) {
  const { C } = useTheme();

export function NavBtn({onClick,title,children}) {
  const { C } = useTheme();

export function DayLabLoader({ size = 32, color = "#EFDFC3" }) {

export function TagChip({ name, onClick, plain = false }) {
  const [calCollapsed, toggleCal] = useCollapse("cal", false);
  const [healthCollapsed, toggleHealth] = useCollapse("health", true);
  const [notesCollapsed, toggleNotes] = useCollapse("notes", false);
  const [tasksCollapsed, toggleTasks] = useCollapse("tasks", false);
  const [taskFilter, setTaskFilter] = useState('all');
  const [mealsCollapsed, toggleMeals] = useCollapse("meals", false);
  const [actCollapsed, toggleAct] = useCollapse("workouts", false);
  const collapseMap = { notes: notesCollapsed, tasks: tasksCollapsed, meals: mealsCollapsed, activity: actCollapsed };

export function NoteChip({ name, onClick }) {
  // Undo/redo
  useEffect(() => {
    const handler = async (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key !== 'z') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;

export function RichLine({ text, dimTag = null }) {
  const { C } = useTheme();
  const { navigateToProject, navigateToNote } = useNavigation();
  }, []);

  const sessionGoogleToken = session?.provider_token;
  const sessionRefreshToken = session?.provider_refresh_token;
  const startSync = useCallback(k => setSyncing(s => new Set([...s, k])), []);
  const endSync = useCallback(k => {
    setSyncing(s => { const n = new Set(s); n.delete(k); return n; });
    setLastSync(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  }, []);

  // Calendar fetch
  const calRefreshRef = useRef(null);
  const fetchCalRef = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (e.detail?.types?.includes('calendar') && fetchCalRef.current) fetchCalRef.current(); };
    window.addEventListener('lifeos:refresh', handler);
    return () => window.removeEventListener('lifeos:refresh', handler);
  }, []);
  useEffect(() => {
    if (!token) return;
    startSync("cal");
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const start = toKey(shift(new Date(), -30)), end = toKey(shift(new Date(), 60));
    const fetchCal = () => fetch("/api/calendar", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token }, body: JSON.stringify({ start, end, tz }) })
      .then(r => r.ok ? r.json() : null).then(d => { if (d?.events) setEvents(prev => Object.assign({}, prev, d.events)); if (d?.googleToken) {} }).catch(() => {}).finally(() => endSync("cal"));
    fetchCalRef.current = fetchCal;
    if (sessionGoogleToken) {
      fetch("/api/google-token", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token }, body: JSON.stringify({ googleToken: sessionGoogleToken, refreshToken: sessionRefreshToken }) }).then(() => fetchCal()).catch(() => fetchCal());
    } else fetchCal();
    calRefreshRef.current = setInterval(fetchCal, 45 * 60 * 1000);
    return () => { if (calRefreshRef.current) clearInterval(calRefreshRef.current); };
  }, [token]);

  const onHealthChange = useCallback(() => {}, []);
  const onScoresReady = useCallback((date, d) => {
    setHealthDots(prev => {
      const p = prev[date] || {};
      return Object.assign({}, prev, { [date]: { sleep: d.sleep?.score ?? p.sleep ?? 0, readiness: d.readiness?.score ?? p.readiness ?? 0, activity: d.activity?.score ?? p.activity ?? 0, recovery: d.recovery?.score ?? p.recovery ?? 0 } });
    });
  }, []);
