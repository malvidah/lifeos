"use client";
import { createContext } from "react";
export const NoteContext = createContext({ notes: [] });
export const ProjectNamesContext = createContext([]);
export const NavigationContext = createContext({ navigateToProject:()=>{}, navigateToNote:()=>{} });
