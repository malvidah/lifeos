"use client";
import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { useTheme } from "@/lib/theme";
import { mono, F, R, projectColor } from "@/lib/tokens";
import { useDbSave } from "@/lib/db";
import { estimateNutrition, uploadImageFile } from "@/lib/images";
import { DayLabEditor } from "../DayLabEditor.jsx";
export function JournalEditor({date,userId,token}) {
  const { C } = useTheme();
export function RowList({date,type,placeholder,promptFn,prefix,color,token,userId,syncedRows=[],showProtein=false}) {
  const { C } = useTheme();
export function Meals({date,token,userId}) {
  const { C } = useTheme();
  return <RowList date={date} type="meals" token={token} userId={userId} placeholder="What did you eat?" promptFn={t=>`Estimate for: "${t}". Return JSON: {"kcal":420,"protein":30}`} prefix="" color={C.accent} showProtein/>;
}
