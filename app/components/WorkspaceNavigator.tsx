"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";

export type NavigationMode = "standard" | "compact";

type NavigationPage = {
  id: string;
  label: string;
  shortLabel: string;
  group: "项目" | "解析" | "实验" | "系统";
};

type NavigatorProject = { id: string; name: string };

const modeLabels: Record<NavigationMode, string> = {
  standard: "标准",
  compact: "紧凑",
};

export function WorkspaceNavigator({
  pages,
  activePage,
  onPageChange,
  projects,
  activeProjectId,
  onProjectChange,
  mode,
  onModeChange,
}: {
  pages: NavigationPage[];
  activePage: string;
  onPageChange: (page: string) => void;
  projects: NavigatorProject[];
  activeProjectId: string;
  onProjectChange: (projectId: string) => void;
  mode: NavigationMode;
  onModeChange: (mode: NavigationMode) => void;
}) {
  const [dialOpen, setDialOpen] = useState(false);
  const [dialIndex, setDialIndex] = useState(() => Math.max(0, pages.findIndex((page) => page.id === activePage)));
  const dialRef = useRef<HTMLDivElement>(null);
  const dialOpenRef = useRef(false);
  const dialIndexRef = useRef(dialIndex);
  const dialCancelledRef = useRef(false);

  useEffect(() => {
    dialOpenRef.current = dialOpen;
  }, [dialOpen]);

  useEffect(() => {
    dialIndexRef.current = dialIndex;
  }, [dialIndex]);

  useEffect(() => {
    function editableTarget(target: EventTarget | null) {
      return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
    }

    function keyDown(event: KeyboardEvent) {
      if (editableTarget(event.target)) return;
      if (event.key === "Escape" && dialOpenRef.current) {
        event.preventDefault();
        dialCancelledRef.current = true;
        dialOpenRef.current = false;
        setDialOpen(false);
        return;
      }
      if (dialOpenRef.current && ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
        const next = (dialIndexRef.current + direction + pages.length) % pages.length;
        dialIndexRef.current = next;
        setDialIndex(next);
        return;
      }
      const isCommandShiftPress = event.metaKey && event.shiftKey && (event.key === "Meta" || event.key === "Shift");
      if (!isCommandShiftPress || event.repeat || dialOpenRef.current) return;
      event.preventDefault();
      const activeIndex = Math.max(0, pages.findIndex((page) => page.id === activePage));
      dialIndexRef.current = activeIndex;
      dialOpenRef.current = true;
      dialCancelledRef.current = false;
      setDialIndex(activeIndex);
      setDialOpen(true);
    }

    function keyUp(event: KeyboardEvent) {
      if ((event.key !== "Meta" && event.key !== "Shift") || !dialOpenRef.current) return;
      event.preventDefault();
      const page = pages[dialIndexRef.current];
      dialOpenRef.current = false;
      setDialOpen(false);
      if (!dialCancelledRef.current && page) onPageChange(page.id);
      dialCancelledRef.current = false;
    }

    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, [activePage, onPageChange, pages]);

  function pointDial(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = dialRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const x = event.clientX - (bounds.left + bounds.width / 2);
    const y = event.clientY - (bounds.top + bounds.height / 2);
    if (Math.hypot(x, y) < 62) return;
    const normalized = (Math.atan2(y, x) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
    const index = Math.round((normalized / (Math.PI * 2)) * pages.length) % pages.length;
    dialIndexRef.current = index;
    setDialIndex(index);
  }

  const groups = ["项目", "解析", "实验", "系统"] as const;

  return (
    <>
      <aside className={`app-sidebar nav-${mode}`} aria-label="软件导航">
        <div className="app-brand">
          <span className="app-mark">CF</span>
          <div>
            <strong>CodeFlow</strong>
            <small>Inspector</small>
          </div>
        </div>

        <label className="project-switcher">
          <span>当前项目</span>
          <select value={activeProjectId} onChange={(event) => onProjectChange(event.target.value)}>
            {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
          </select>
        </label>

        <nav className="sidebar-navigation">
          {groups.map((group) => (
            <section key={group}>
              <p>{group}</p>
              {pages.filter((page) => page.group === group).map((page) => (
                <button
                  key={page.id}
                  className={page.id === activePage ? "active" : ""}
                  onClick={() => onPageChange(page.id)}
                  title={page.label}
                  aria-current={page.id === activePage ? "page" : undefined}
                >
                  <span>{page.shortLabel}</span>
                  <b>{page.label}</b>
                </button>
              ))}
            </section>
          ))}
        </nav>

        <label className="navigation-mode">
          <span>导航样式</span>
          <select value={mode} onChange={(event) => onModeChange(event.target.value as NavigationMode)}>
            {(Object.keys(modeLabels) as NavigationMode[]).map((item) => (
              <option value={item} key={item}>{modeLabels[item]}</option>
            ))}
          </select>
        </label>
      </aside>

      {dialOpen && (
        <div className="navigation-dial-backdrop" role="dialog" aria-label="按住 Command 加 Shift 的快捷页面选择盘" onPointerMove={pointDial}>
          <div
            className="navigation-dial"
            ref={dialRef}
            style={{ "--dial-count": pages.length, "--dial-index": dialIndex } as CSSProperties}
          >
            <div className="dial-segment-ring" aria-hidden="true" />
            <div className="dial-selection-wedge" aria-hidden="true" />
            {pages.map((page, index) => {
              const angle = (index / pages.length) * Math.PI * 2 - Math.PI / 2;
              const x = Math.cos(angle) * 142;
              const y = Math.sin(angle) * 142;
              return (
                <button
                  key={page.id}
                  className={`${index === dialIndex ? "active" : ""} dial-group-${page.group}`}
                  style={{ transform: `translate(${x}px, ${y}px)`, "--item-index": index } as CSSProperties}
                  onPointerEnter={() => {
                    dialIndexRef.current = index;
                    setDialIndex(index);
                  }}
                  onClick={() => {
                    onPageChange(page.id);
                    dialOpenRef.current = false;
                    setDialOpen(false);
                  }}
                  aria-label={`${page.group}：${page.label}`}
                >
                  <span>{page.shortLabel}</span>
                  <b>{page.label}</b>
                </button>
              );
            })}
            <div className="dial-center">
              <kbd className="dial-shortcut"><span>⌘</span><span>⇧</span></kbd>
              <span>{pages[dialIndex]?.group}</span>
              <strong>{pages[dialIndex]?.label}</strong>
              <small>移动选择 · 松开进入 · Esc 取消</small>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
