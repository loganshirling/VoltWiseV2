import React, { useRef, useState } from 'react';
import { Download, FolderOpen } from 'lucide-react';
import { ProjectArchiveState, ValidatedProjectState } from '../types/energy';
import { parseProjectArchive, serializeProjectArchive } from '../utils/projectArchive';

interface ProjectFileControlsProps {
  projectState: ProjectArchiveState;
  onProjectLoaded: (project: ValidatedProjectState) => void;
}

export const ProjectFileControls: React.FC<ProjectFileControlsProps> = ({ projectState, onProjectLoaded }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ kind: 'status' | 'error'; message: string } | null>(null);

  const handleSave = () => {
    try {
      const blob = serializeProjectArchive(projectState);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `VoltWise_Project_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus({ kind: 'status', message: 'Project file saved to your browser downloads.' });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Project could not be saved.' });
    }
  };

  const handleFileSelection = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatus(null);
    try {
      const project = await parseProjectArchive(await file.text());
      const confirmed = window.confirm(
        'Opening this project replaces your current load data, battery and tariff settings, generation assets and resource files, and financial assumptions. Save your current project first if you want to keep it. Continue?'
      );
      if (!confirmed) {
        setStatus({ kind: 'status', message: 'Open canceled. Your current project is unchanged.' });
        return;
      }
      onProjectLoaded(project);
      setStatus({ kind: 'status', message: `Opened ${file.name}.` });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Project file could not be opened.' });
    } finally {
      event.target.value = '';
    }
  };

  return (
    <section aria-labelledby="project-files-heading" className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="project-files-heading" className="text-sm font-semibold text-white">Local Project File</h2>
          <p className="mt-1 text-xs text-slate-400">Save settings and source data as a file on your device, or open a saved project.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
          >
            <Download aria-hidden="true" className="h-4 w-4" /> Save Project
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          >
            <FolderOpen aria-hidden="true" className="h-4 w-4" /> Open Project
          </button>
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept=".json,application/json"
            aria-label="Choose a VoltWise project JSON file"
            onChange={handleFileSelection}
          />
        </div>
      </div>
      {status && (
        <p role={status.kind === 'error' ? 'alert' : 'status'} className={`mt-3 text-xs ${status.kind === 'error' ? 'text-rose-300' : 'text-emerald-300'}`}>
          {status.message}
        </p>
      )}
    </section>
  );
};
