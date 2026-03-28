"use client";
import React from "react";
import dynamic from "next/dynamic";
import { mono, F } from "@/lib/tokens";
import { Card, ErrorBoundary } from "../ui/primitives.jsx";
import CalendarCard from "../cards/CalendarCard.jsx";
import HealthCard from "../cards/HealthCard.jsx";
import HabitsCard, { HabitFilterBtns } from "../cards/HabitsCard.jsx";
import WorkoutsCard from "../cards/WorkoutsCard.jsx";
const MapCard = dynamic(
  () => import("../cards/MapCard.jsx").then(m => ({ default: m.MapCard })),
  { ssr: false }
);
const WorldMapCard = dynamic(
  () => import("../cards/WorldMapCard.jsx"),
  { ssr: false }
);
import GoalsCard, { GoalsViewToggle } from "../cards/GoalsCard.jsx";
import { JournalEditor, JournalModeToggle, Meals } from "../widgets/JournalEditor.jsx";
import Tasks, { TaskFilterBtns, TaskSaveIndicator } from "../widgets/Tasks.jsx";
import NotesCard from "../widgets/NotesCard.jsx";

const GOAL_COLOR = "#5BA89D";

const MEALS_HDR = <span style={{display:"flex",gap:0}}><span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--dl-middle)",width:50,textAlign:"center"}}>prot</span><span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--dl-middle)",width:72,textAlign:"center"}}>energy</span></span>;
const ACT_HDR = <span style={{display:"flex",gap:0}}>
  <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--dl-middle)",width:60,textAlign:"center"}}>dist</span>
  <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--dl-middle)",width:100,textAlign:"center"}}>pace</span>
  <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--dl-middle)",width:72,textAlign:"center"}}>energy</span>
</span>;

export const CARD_REGISTRY = [
  {
    id: 'project-graph',
    label: '⛰️ Projects',
    icon: <span style={{fontSize:14,lineHeight:1}}>⛰️</span>,
    render: (props) => {
      if (!props.graphData || props.searchOpen || props.mapCollapsed) return null;
      return (
        <MapCard
          allTags={props.graphData.allTags}
          connections={props.graphData.connections}
          recency={props.graphData.recency}
          entryCounts={props.graphData.entryCounts}
          completedTasks={props.graphData.completedTasks}
          habits={props.graphData.habits}
          healthDots={props.healthDots}
          selectedProject={props.projectFilter}
          onSelectProject={props.selectProject}
          date={props.date}
          token={props.token}
        />
      );
    },
  },
  {
    id: 'cal',
    label: '📅 Calendar',
    icon: <span style={{fontSize:14,lineHeight:1}}>📅</span>,
    render: (props) => {
      if (props.searchOpen || props.calCollapsed) return null;
      return (
        <div style={{flexShrink:0}}>
          <ErrorBoundary label="Calendar">
          <CalendarCard selected={props.date} onSelect={props.setSelected}
            events={props.events} setEvents={props.setEvents} healthDots={props.healthDots}
            token={props.token} collapsed={false}
            calView={props.calView} onCalViewChange={v=>{props.setCalView(v);}} expandHref="/calendar"/>
          </ErrorBoundary>
        </div>
      );
    },
  },
  {
    id: 'world-map',
    label: '🗺️ Map',
    icon: <span style={{fontSize:14,lineHeight:1}}>🗺️</span>,
    render: (props) => {
      if (props.searchOpen || props.timelineCollapsed) return null;
      return (
        <WorldMapCard token={props.token} />
      );
    },
  },
  {
    id: 'goals',
    label: '🏁 Goals',
    icon: <span style={{fontSize:14,lineHeight:1}}>🏁</span>,
    render: (props) => {
      if (props.searchOpen || props.goalsCollapsed) return null;
      return (
        <div style={{flexShrink:0}}>
          <ErrorBoundary label="Goals">
            <Card label="🏁 Goals" color={GOAL_COLOR} collapsed={false} autoHeight expandHref="/goals"
              headerRight={<GoalsViewToggle mode={props.goalsViewMode} setMode={props.setGoalsViewMode} />}>
              <GoalsCard token={props.token} date={props.date} onSelectDate={props.setSelected} viewMode={props.goalsViewMode} project={props.projectFilter} />
            </Card>
          </ErrorBoundary>
        </div>
      );
    },
  },
  {
    id: 'health',
    label: '❤️ Health',
    icon: <span style={{fontSize:14,lineHeight:1}}>❤️</span>,
    render: (props) => {
      if (props.searchOpen || props.healthCollapsed) return null;
      return (
        <div style={{flexShrink:0}}>
          <ErrorBoundary label="Health">
          <HealthCard date={props.date} token={props.token} userId={props.userId}
            onHealthChange={props.onHealthChange} onScoresReady={props.onScoresReady} onSyncStart={props.startSync} onSyncEnd={props.endSync}
            collapsed={false} expandHref="/health"/>
          </ErrorBoundary>
        </div>
      );
    },
  },
  {
    id: 'habits',
    label: '🎯 Habits',
    icon: <span style={{fontSize:14,lineHeight:1}}>🎯</span>,
    render: (props) => {
      if (props.searchOpen || props.habitsCollapsed) return null;
      return (
        <div style={{flexShrink:0}}>
          <ErrorBoundary label="Habits">
            <Card label="🎯 Habits" color="var(--dl-accent)" collapsed={false} autoHeight
              expandHref="/habits"
              headerRight={<HabitFilterBtns filter={props.habitFilter} setFilter={props.setHabitFilter}/>}>
              <HabitsCard date={props.date} token={props.token} userId={props.userId} project={props.projectFilter} habitFilter={props.habitFilter} onSelectDate={props.setSelected}/>
            </Card>
          </ErrorBoundary>
        </div>
      );
    },
  },
  {
    id: 'notes',
    label: '📄 Notes',
    icon: <span style={{fontSize:14,lineHeight:1}}>📄</span>,
    render: (props) => {
      if (props.searchOpen || props.notesCollapsed) return null;
      return (
        <ErrorBoundary label="Notes">
          <NotesCard project={props.projectFilter} token={props.token} userId={props.userId} onNoteNamesChange={props.setAllNoteNames} collapsed={false} expandHref="/notes" />
        </ErrorBoundary>
      );
    },
  },
  {
    id: 'tasks',
    label: '☑️ Tasks',
    icon: <span style={{fontSize:14,lineHeight:1}}>☑️</span>,
    render: (props) => {
      if (props.searchOpen || props.tasksCollapsed) return null;
      return (
        <ErrorBoundary label="☑️ Tasks">
        <Card label="☑️ Tasks" color="var(--dl-blue)"
          collapsed={false}
          expandHref="/tasks"
          headerRight={<><TaskSaveIndicator /><TaskFilterBtns filter={props.taskFilter} setFilter={props.setTaskFilter}/></>}>
          <Tasks date={props.date} token={props.token} userId={props.userId} stravaConnected={props.stravaConnected}
            taskFilter={props.taskFilter}
            project={props.projectFilter||undefined}/>
        </Card>
        </ErrorBoundary>
      );
    },
  },
  {
    id: 'journal',
    label: '📓 Journal',
    icon: <span style={{fontSize:14,lineHeight:1}}>📓</span>,
    render: (props) => {
      if (props.searchOpen || props.journalCollapsed) return null;
      return (
        <ErrorBoundary label="📓 Journal">
        <Card label="📓 Journal" color="var(--dl-accent)"
          collapsed={false}
          expandHref="/journal"
          headerRight={<JournalModeToggle mode={props.journalMode} setMode={props.setJournalMode}/>}>
          <JournalEditor date={props.date} token={props.token} userId={props.userId} stravaConnected={props.stravaConnected} project={props.projectFilter||undefined} journalMode={props.journalMode}/>
        </Card>
        </ErrorBoundary>
      );
    },
  },
  {
    id: 'meals',
    label: '🍽️ Meals',
    icon: <span style={{fontSize:14,lineHeight:1}}>🍽️</span>,
    render: (props) => {
      if (props.searchOpen || props.mealsCollapsed) return null;
      return (
        <ErrorBoundary label="🍽️ Meals">
        <Card label="🍽️ Meals" color="var(--dl-red)"
          collapsed={false}
          expandHref={undefined}
          headerRight={MEALS_HDR}>
          <Meals date={props.date} token={props.token} userId={props.userId} stravaConnected={props.stravaConnected}/>
        </Card>
        </ErrorBoundary>
      );
    },
  },
  {
    id: 'workouts',
    label: '💪 Workouts',
    icon: <span style={{fontSize:14,lineHeight:1}}>💪</span>,
    render: (props) => {
      if (props.searchOpen || props.actCollapsed) return null;
      return (
        <ErrorBoundary label="💪 Workouts">
        <Card label="💪 Workouts" color="var(--dl-green)"
          collapsed={false}
          expandHref={undefined}
          headerRight={ACT_HDR}>
          <WorkoutsCard date={props.date} token={props.token} userId={props.userId} stravaConnected={props.stravaConnected}/>
        </Card>
        </ErrorBoundary>
      );
    },
  },
];
