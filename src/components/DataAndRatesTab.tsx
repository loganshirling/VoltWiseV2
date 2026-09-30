import React, { useState, useRef, useMemo } from 'react';
import {
  Upload,
  Download,
  CheckCircle2,
  AlertCircle,
  Paintbrush,
  Sparkles,
  Plus,
  Trash2,
  Calendar,
  Copy,
  RotateCcw,
  Check,
  Bookmark,
  Building,
  Sun,
  Snowflake,
  Layers,
  ArrowUpDown,
  Info,
  Sliders,
  TrendingUp,
  Table as TableIcon,
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  CsvValidationResult,
  RateTier,
  TouProfile,
  TouSeason,
  UI_DAY_NAMES,
  uiRowIndexToDayOfWeek,
  dayOfWeekToUiRowIndex,
  isWeekendDay,
} from '../types/energy';
import { DEFAULT_TOU_PROFILES, ScheduleMatrix } from '../utils/simulationEngine';
import { generateStandardCsvTemplate } from '../utils/sampleData';

interface DataAndRatesTabProps {
  csvResult: CsvValidationResult | null;
  onFileUpload: (file: File) => void;
  onLoadSample: () => void;
  touProfiles: TouProfile[];
  setTouProfiles: React.Dispatch<React.SetStateAction<TouProfile[]>>;
  activeTouProfileId: string;
  setActiveTouProfileId: (id: string) => void;
  tiers: RateTier[];
  setTiers: React.Dispatch<React.SetStateAction<RateTier[]>>;
  scheduleMatrix: ScheduleMatrix;
  setScheduleMatrix: React.Dispatch<React.SetStateAction<ScheduleMatrix>>;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const SEASON_THEMES = [
  {
    key: 'summer',
    border: 'border-amber-500/40',
    bg: 'bg-amber-950/20',
    hoverBg: 'hover:bg-amber-950/40',
    activeBg: 'bg-amber-950/40',
    activeBorder: 'border-amber-400',
    text: 'text-amber-300',
    badge: 'bg-amber-400',
    dot: 'bg-amber-400',
    icon: Sun,
  },
  {
    key: 'winter',
    border: 'border-cyan-500/40',
    bg: 'bg-cyan-950/20',
    hoverBg: 'hover:bg-cyan-950/40',
    activeBg: 'bg-cyan-950/40',
    activeBorder: 'border-cyan-400',
    text: 'text-cyan-300',
    badge: 'bg-cyan-400',
    dot: 'bg-cyan-400',
    icon: Snowflake,
  },
  {
    key: 'shoulder',
    border: 'border-emerald-500/40',
    bg: 'bg-emerald-950/20',
    hoverBg: 'hover:bg-emerald-950/40',
    activeBg: 'bg-emerald-950/40',
    activeBorder: 'border-emerald-400',
    text: 'text-emerald-300',
    badge: 'bg-emerald-400',
    dot: 'bg-emerald-400',
    icon: Layers,
  },
  {
    key: 'custom',
    border: 'border-purple-500/40',
    bg: 'bg-purple-950/20',
    hoverBg: 'hover:bg-purple-950/40',
    activeBg: 'bg-purple-950/40',
    activeBorder: 'border-purple-400',
    text: 'text-purple-300',
    badge: 'bg-purple-400',
    dot: 'bg-purple-400',
    icon: Sliders,
  },
];

export const DataAndRatesTab: React.FC<DataAndRatesTabProps> = ({
  csvResult,
  onFileUpload,
  onLoadSample,
  touProfiles,
  setTouProfiles,
  activeTouProfileId,
  setActiveTouProfileId,
  tiers,
  setTiers,
  scheduleMatrix,
  setScheduleMatrix,
}) => {
  const currentTouProfile =
    touProfiles.find((p) => p.id === activeTouProfileId) || touProfiles[0];

  // Ensure current TOU profile has initialized seasons
  const seasons: TouSeason[] = useMemo(() => {
    if (currentTouProfile.seasons && currentTouProfile.seasons.length > 0) {
      return currentTouProfile.seasons;
    }
    // Fallback default 2-season (Summer / Winter) if empty
    return [
      {
        id: 'default-summer',
        name: 'Summer (June – Sept)',
        months: [5, 6, 7, 8],
        tierRates: tiers.reduce((acc, t) => {
          acc[t.id] = {
            buyRate: Math.round(t.buyRate * 1.25 * 100) / 100,
            sellRate: Math.round(t.sellRate * 1.15 * 100) / 100,
          };
          return acc;
        }, {} as Record<string, { buyRate: number; sellRate: number }>),
      },
      {
        id: 'default-winter',
        name: 'Winter (Oct – May)',
        months: [0, 1, 2, 3, 4, 9, 10, 11],
        tierRates: tiers.reduce((acc, t) => {
          acc[t.id] = { buyRate: t.buyRate, sellRate: t.sellRate };
          return acc;
        }, {} as Record<string, { buyRate: number; sellRate: number }>),
      },
    ];
  }, [currentTouProfile, tiers]);

  const [activeSeasonId, setActiveSeasonId] = useState<string>(seasons[0]?.id || '');
  const [activeTierId, setActiveTierId] = useState<string>(tiers[0]?.id || 'off-peak');
  const [matrixPreviewSeasonId, setMatrixPreviewSeasonId] = useState<string>('');
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [dragOverCell, setDragOverCell] = useState<{ day: number; hour: number } | null>(null);
  const [showSchemaGuide, setShowSchemaGuide] = useState(true);
  const [showDataPreview, setShowDataPreview] = useState(true);
  const [previewRowLimit, setPreviewRowLimit] = useState(24);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync active season id if current season was removed
  const currentActiveSeason =
    seasons.find((s) => s.id === activeSeasonId) || seasons[0];

  // Helper to commit seasons array back to currentTouProfile
  const commitSeasons = (nextSeasons: TouSeason[]) => {
    setTouProfiles((prev) =>
      prev.map((p) =>
        p.id === currentTouProfile.id ? { ...p, seasons: nextSeasons } : p
      )
    );
  };

  // Download template file helper
  const handleDownloadTemplate = () => {
    const csvContent = generateStandardCsvTemplate();
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'energy_usage_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleCellPaint = (canonicalDow: number, hour: number) => {
    const nextMatrix = scheduleMatrix.map((row, d) =>
      d === canonicalDow
        ? row.map((cell, h) => (h === hour ? activeTierId : cell))
        : [...row]
    );
    setScheduleMatrix(nextMatrix);

    setTouProfiles((prev) =>
      prev.map((p) =>
        p.id === currentTouProfile.id
          ? { ...p, scheduleMatrix: nextMatrix }
          : p
      )
    );
  };

  const handleMouseDownCell = (canonicalDow: number, hour: number) => {
    setIsMouseDown(true);
    handleCellPaint(canonicalDow, hour);
  };

  const handleMouseEnterCell = (canonicalDow: number, hour: number) => {
    setDragOverCell({ day: canonicalDow, hour });
    if (isMouseDown) {
      handleCellPaint(canonicalDow, hour);
    }
  };

  const handleMouseUp = () => {
    setIsMouseDown(false);
  };

  // Rate Tier CRUD
  const handleAddTier = () => {
    const newId = `tier-${Date.now()}`;
    const colors = ['#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    const assignedColor = colors[tiers.length % colors.length];
    const newTier: RateTier = {
      id: newId,
      name: `Tier ${tiers.length + 1}`,
      buyRate: 0.25,
      sellRate: 0.06,
      color: assignedColor,
      isChargeWindow: false,
      isDischargeWindow: false,
    };
    const updatedTiers = [...tiers, newTier];
    setTiers(updatedTiers);
    setActiveTierId(newId);

    // Also inject new tier into all seasons
    const updatedSeasons = seasons.map((s) => ({
      ...s,
      tierRates: {
        ...s.tierRates,
        [newId]: { buyRate: newTier.buyRate, sellRate: newTier.sellRate },
      },
    }));

    setTouProfiles((prev) =>
      prev.map((p) =>
        p.id === currentTouProfile.id
          ? { ...p, tiers: updatedTiers, seasons: updatedSeasons }
          : p
      )
    );
  };

  const handleUpdateTier = (tierId: string, field: keyof RateTier, value: any) => {
    const updatedTiers = tiers.map((t) => (t.id === tierId ? { ...t, [field]: value } : t));
    setTiers(updatedTiers);

    // Sync to current active season's tier rates as well
    const updatedSeasons = seasons.map((s) => {
      if (s.id === currentActiveSeason.id && (field === 'buyRate' || field === 'sellRate')) {
        return {
          ...s,
          tierRates: {
            ...s.tierRates,
            [tierId]: {
              ...(s.tierRates[tierId] || { buyRate: 0.2, sellRate: 0.05 }),
              [field]: value,
            },
          },
        };
      }
      return s;
    });

    setTouProfiles((prev) =>
      prev.map((p) =>
        p.id === currentTouProfile.id
          ? { ...p, tiers: updatedTiers, seasons: updatedSeasons }
          : p
      )
    );
  };

  const handleDeleteTier = (tierId: string) => {
    if (tiers.length <= 1) return;
    const remaining = tiers.filter((t) => t.id !== tierId);
    const fallbackId = remaining[0].id;
    setTiers(remaining);
    if (activeTierId === tierId) {
      setActiveTierId(fallbackId);
    }

    const nextMatrix = scheduleMatrix.map((row) =>
      row.map((cell) => (cell === tierId ? fallbackId : cell))
    );
    setScheduleMatrix(nextMatrix);

    const updatedSeasons = seasons.map((s) => {
      const nextRates = { ...s.tierRates };
      delete nextRates[tierId];
      return { ...s, tierRates: nextRates };
    });

    setTouProfiles((prev) =>
      prev.map((p) =>
        p.id === currentTouProfile.id
          ? {
              ...p,
              tiers: remaining,
              scheduleMatrix: nextMatrix,
              seasons: updatedSeasons,
            }
          : p
      )
    );
  };

  // Bulk paint shortcuts - operating on canonical day-of-week indices (0=Sun, 1=Mon, ..., 6=Sat)
  const applyBulkSchedule = (
    mode: 'weekdays-peak' | 'all-super-offpeak-night' | 'reset-california' | 'fill-active'
  ) => {
    const nextMatrix: ScheduleMatrix = [];

    for (let dow = 0; dow < 7; dow++) {
      const row: string[] = [];
      const isWeekend = isWeekendDay(dow);

      for (let hour = 0; hour < 24; hour++) {
        if (mode === 'fill-active') {
          row.push(activeTierId);
        } else if (mode === 'weekdays-peak') {
          if (!isWeekend && hour >= 16 && hour < 21) {
            row.push(activeTierId);
          } else {
            row.push(scheduleMatrix[dow]?.[hour] || activeTierId);
          }
        } else if (mode === 'all-super-offpeak-night') {
          if (hour >= 0 && hour < 6) {
            row.push(activeTierId);
          } else {
            row.push(scheduleMatrix[dow]?.[hour] || activeTierId);
          }
        } else if (mode === 'reset-california') {
          const superOff = tiers.find((t) => t.id.includes('super'))?.id || tiers[0].id;
          const off = tiers.find((t) => t.id === 'off-peak')?.id || tiers[0].id;
          const mid = tiers.find((t) => t.id === 'mid-peak')?.id || tiers[0].id;
          const on = tiers.find((t) => t.id === 'on-peak')?.id || tiers[tiers.length - 1].id;

          if (hour >= 0 && hour < 6) {
            row.push(superOff);
          } else if (hour >= 16 && hour < 21) {
            row.push(isWeekend ? mid : on);
          } else {
            row.push(off);
          }
        }
      }
      nextMatrix.push(row);
    }

    setScheduleMatrix(nextMatrix);

    setTouProfiles((prev) =>
      prev.map((p) =>
        p.id === currentTouProfile.id
          ? { ...p, scheduleMatrix: nextMatrix }
          : p
      )
    );
  };

  // TOU Profile Operations
  const handleSelectTouProfile = (profileId: string) => {
    const selected = touProfiles.find((p) => p.id === profileId);
    if (!selected) return;
    setActiveTouProfileId(selected.id);
    setTiers(selected.tiers);
    setScheduleMatrix(selected.scheduleMatrix);
    setActiveTierId(selected.tiers[0]?.id || '');
    if (selected.seasons && selected.seasons.length > 0) {
      setActiveSeasonId(selected.seasons[0].id);
    }
  };

  const handleCreateNewTouProfile = () => {
    const newId = `tou-profile-${Date.now()}`;
    const newTiers: RateTier[] = [
      {
        id: 'off-peak',
        name: 'Off-Peak (Night/Morning)',
        buyRate: 0.15,
        sellRate: 0.05,
        color: '#10b981',
        isChargeWindow: true,
        isDischargeWindow: false,
      },
      {
        id: 'on-peak',
        name: 'On-Peak (Evening)',
        buyRate: 0.45,
        sellRate: 0.12,
        color: '#ef4444',
        isChargeWindow: false,
        isDischargeWindow: true,
      },
    ];

    const newMatrix: ScheduleMatrix = [];
    for (let dow = 0; dow < 7; dow++) {
      const row: string[] = [];
      const isWeekend = isWeekendDay(dow);
      for (let hour = 0; hour < 24; hour++) {
        if (!isWeekend && hour >= 16 && hour < 21) {
          row.push('on-peak');
        } else {
          row.push('off-peak');
        }
      }
      newMatrix.push(row);
    }

    const newSeasons: TouSeason[] = [
      {
        id: `season-summer-${Date.now()}`,
        name: 'Summer (June – Sept)',
        months: [5, 6, 7, 8],
        tierRates: {
          'off-peak': { buyRate: 0.18, sellRate: 0.06 },
          'on-peak': { buyRate: 0.52, sellRate: 0.14 },
        },
      },
      {
        id: `season-winter-${Date.now()}`,
        name: 'Winter (Oct – May)',
        months: [0, 1, 2, 3, 4, 9, 10, 11],
        tierRates: {
          'off-peak': { buyRate: 0.13, sellRate: 0.04 },
          'on-peak': { buyRate: 0.38, sellRate: 0.10 },
        },
      },
    ];

    const newProfile: TouProfile = {
      id: newId,
      name: `Custom Rate Tariff ${touProfiles.length + 1}`,
      utility: 'Municipal / Regional Utility',
      description: 'Custom user-defined seasonal time-of-use rate schedule and tiers.',
      tiers: newTiers,
      scheduleMatrix: newMatrix,
      seasons: newSeasons,
    };

    const updated = [...touProfiles, newProfile];
    setTouProfiles(updated);
    setActiveTouProfileId(newId);
    setTiers(newTiers);
    setScheduleMatrix(newMatrix);
    setActiveTierId('off-peak');
    setActiveSeasonId(newSeasons[0].id);
  };

  const handleDuplicateTouProfile = () => {
    const newId = `tou-profile-${Date.now()}`;
    const duplicated: TouProfile = {
      ...currentTouProfile,
      id: newId,
      name: `${currentTouProfile.name} (Copy)`,
      tiers: currentTouProfile.tiers.map((t) => ({ ...t })),
      scheduleMatrix: currentTouProfile.scheduleMatrix.map((row) => [...row]),
      seasons: currentTouProfile.seasons?.map((s) => ({
        ...s,
        months: [...s.months],
        tierRates: { ...s.tierRates },
      })),
    };
    const updated = [...touProfiles, duplicated];
    setTouProfiles(updated);
    setActiveTouProfileId(newId);
    setTiers(duplicated.tiers);
    setScheduleMatrix(duplicated.scheduleMatrix);
    if (duplicated.seasons && duplicated.seasons.length > 0) {
      setActiveSeasonId(duplicated.seasons[0].id);
    }
  };

  const handleDeleteTouProfile = (profileId: string) => {
    if (touProfiles.length <= 1) return;
    const remaining = touProfiles.filter((p) => p.id !== profileId);
    setTouProfiles(remaining);
    if (activeTouProfileId === profileId) {
      const fallback = remaining[0];
      setActiveTouProfileId(fallback.id);
      setTiers(fallback.tiers);
      setScheduleMatrix(fallback.scheduleMatrix);
      setActiveTierId(fallback.tiers[0]?.id || '');
      if (fallback.seasons && fallback.seasons.length > 0) {
        setActiveSeasonId(fallback.seasons[0].id);
      }
    }
  };

  const handleResetToStandardProfiles = () => {
    setTouProfiles(DEFAULT_TOU_PROFILES);
    const first = DEFAULT_TOU_PROFILES[0];
    setActiveTouProfileId(first.id);
    setTiers(first.tiers);
    setScheduleMatrix(first.scheduleMatrix);
    setActiveTierId(first.tiers[0]?.id || '');
    if (first.seasons && first.seasons.length > 0) {
      setActiveSeasonId(first.seasons[0].id);
    }
  };

  const handleUpdateProfileMeta = (
    field: 'name' | 'utility' | 'description',
    value: string
  ) => {
    setTouProfiles((prev) =>
      prev.map((p) =>
        p.id === currentTouProfile.id ? { ...p, [field]: value } : p
      )
    );
  };

  // ==========================================
  // SEASONAL MONTH RANGE OPERATIONS
  // ==========================================
  const handleAddSeason = () => {
    const newId = `season-${Date.now()}`;
    // Find unassigned months
    const assignedMonths = new Set<number>();
    seasons.forEach((s) => s.months.forEach((m) => assignedMonths.add(m)));
    const unassigned: number[] = [];
    for (let m = 0; m < 12; m++) {
      if (!assignedMonths.has(m)) unassigned.push(m);
    }

    const defaultTierRates: Record<string, { buyRate: number; sellRate: number }> = {};
    tiers.forEach((t) => {
      defaultTierRates[t.id] = { buyRate: t.buyRate, sellRate: t.sellRate };
    });

    const newSeason: TouSeason = {
      id: newId,
      name: `Month Range ${seasons.length + 1}`,
      months: unassigned.length > 0 ? unassigned : [4, 5],
      tierRates: defaultTierRates,
    };

    const nextSeasons = [...seasons, newSeason];
    commitSeasons(nextSeasons);
    setActiveSeasonId(newId);
  };

  const handleDeleteSeason = (seasonId: string) => {
    if (seasons.length <= 1) return;
    const remaining = seasons.filter((s) => s.id !== seasonId);
    commitSeasons(remaining);
    if (activeSeasonId === seasonId) {
      setActiveSeasonId(remaining[0].id);
    }
  };

  const handleUpdateSeasonName = (seasonId: string, name: string) => {
    const nextSeasons = seasons.map((s) =>
      s.id === seasonId ? { ...s, name } : s
    );
    commitSeasons(nextSeasons);
  };

  const handleToggleMonthInSeason = (seasonId: string, monthIdx: number) => {
    // If month is in this season, toggle it off
    // If month is in another season, transfer it to this season
    const nextSeasons = seasons.map((s) => {
      if (s.id === seasonId) {
        const hasMonth = s.months.includes(monthIdx);
        return {
          ...s,
          months: hasMonth
            ? s.months.filter((m) => m !== monthIdx)
            : [...s.months, monthIdx].sort((a, b) => a - b),
        };
      } else {
        // Remove from other season to keep non-overlapping partitions
        return {
          ...s,
          months: s.months.filter((m) => m !== monthIdx),
        };
      }
    });
    commitSeasons(nextSeasons);
  };

  const handleUpdateSeasonTierRate = (
    seasonId: string,
    tierId: string,
    field: 'buyRate' | 'sellRate',
    val: number
  ) => {
    const nextSeasons = seasons.map((s) => {
      if (s.id === seasonId) {
        const currentTierRate = s.tierRates?.[tierId] || {
          buyRate: tiers.find((t) => t.id === tierId)?.buyRate || 0.2,
          sellRate: tiers.find((t) => t.id === tierId)?.sellRate || 0.05,
        };
        return {
          ...s,
          tierRates: {
            ...s.tierRates,
            [tierId]: {
              ...currentTierRate,
              [field]: val,
            },
          },
        };
      }
      return s;
    });
    commitSeasons(nextSeasons);
  };

  const handleApplySeasonPreset = (
    preset: 'summer-winter' | 'three-season' | 'quarterly' | 'uniform'
  ) => {
    let nextSeasons: TouSeason[] = [];

    const makeTierRates = (factor: number) => {
      const res: Record<string, { buyRate: number; sellRate: number }> = {};
      tiers.forEach((t) => {
        res[t.id] = {
          buyRate: Math.round(t.buyRate * factor * 100) / 100,
          sellRate: Math.round(t.sellRate * factor * 100) / 100,
        };
      });
      return res;
    };

    if (preset === 'summer-winter') {
      nextSeasons = [
        {
          id: `season-summer-${Date.now()}`,
          name: 'Summer (June – Sept)',
          months: [5, 6, 7, 8],
          tierRates: makeTierRates(1.28),
        },
        {
          id: `season-winter-${Date.now()}`,
          name: 'Winter (Oct – May)',
          months: [0, 1, 2, 3, 4, 9, 10, 11],
          tierRates: makeTierRates(1.0),
        },
      ];
    } else if (preset === 'three-season') {
      nextSeasons = [
        {
          id: `season-summer-${Date.now()}`,
          name: 'Summer Peak (Jun – Aug)',
          months: [5, 6, 7],
          tierRates: makeTierRates(1.35),
        },
        {
          id: `season-shoulder-${Date.now()}`,
          name: 'Shoulder (Mar–May, Sep–Oct)',
          months: [2, 3, 4, 8, 9],
          tierRates: makeTierRates(1.10),
        },
        {
          id: `season-winter-${Date.now()}`,
          name: 'Winter (Nov – Feb)',
          months: [0, 1, 10, 11],
          tierRates: makeTierRates(0.95),
        },
      ];
    } else if (preset === 'quarterly') {
      nextSeasons = [
        {
          id: `season-q1-${Date.now()}`,
          name: 'Q1 (Jan – Mar)',
          months: [0, 1, 2],
          tierRates: makeTierRates(0.95),
        },
        {
          id: `season-q2-${Date.now()}`,
          name: 'Q2 (Apr – Jun)',
          months: [3, 4, 5],
          tierRates: makeTierRates(1.10),
        },
        {
          id: `season-q3-${Date.now()}`,
          name: 'Q3 (Jul – Sep)',
          months: [6, 7, 8],
          tierRates: makeTierRates(1.35),
        },
        {
          id: `season-q4-${Date.now()}`,
          name: 'Q4 (Oct – Dec)',
          months: [9, 10, 11],
          tierRates: makeTierRates(1.05),
        },
      ];
    } else if (preset === 'uniform') {
      nextSeasons = [
        {
          id: `season-all-year-${Date.now()}`,
          name: 'Year-Round (Jan – Dec)',
          months: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
          tierRates: makeTierRates(1.0),
        },
      ];
    }

    commitSeasons(nextSeasons);
    setActiveSeasonId(nextSeasons[0].id);
  };

  const activeTier = tiers.find((t) => t.id === activeTierId) || tiers[0] || {
    id: 'unknown',
    name: 'Unknown',
    buyRate: 0,
    sellRate: 0,
    color: '#64748b',
  };

  // Season to preview in schedule matrix
  const matrixPreviewSeason =
    seasons.find((s) => s.id === matrixPreviewSeasonId) || currentActiveSeason;

  return (
    <div className="space-y-10" onMouseUp={handleMouseUp}>
      {/* SECTION 1: CSV DATA INGESTION & VALIDATION */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <span className="text-emerald-400 font-mono text-base">01.</span>
              Interval Usage Ingestion & Validation
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Strict schema required: <code className="text-emerald-400 font-mono">Day, Hour of Day, Hourly Total, Daily Total, Unit of Measurement</code>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadTemplate}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded-lg transition-colors whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5 text-slate-400" />
              <span>Download Schema Template</span>
            </button>
            <button
              onClick={onLoadSample}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-300 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/30 rounded-lg transition-colors whitespace-nowrap"
            >
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
              <span>Load 8,760h Household Profile</span>
            </button>
          </div>
        </div>

        {/* Schema Specification Guide Card */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
          <div
            onClick={() => setShowSchemaGuide(!showSchemaGuide)}
            className="flex items-center justify-between px-4 py-2.5 bg-slate-900/70 border-b border-slate-800/80 cursor-pointer hover:bg-slate-900 transition-colors"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
              <span>Interval Usage Required Schema Specification</span>
              <span className="px-2 py-0.5 text-[10px] font-mono bg-emerald-950/70 text-emerald-400 border border-emerald-500/30 rounded">
                5 Required Columns
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
              <span>{showSchemaGuide ? 'Hide Format Guide' : 'Show Format Guide'}</span>
              {showSchemaGuide ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </div>

          {showSchemaGuide && (
            <div className="p-4 space-y-3 text-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-700/80 text-slate-300 bg-slate-950/80">
                      <th className="py-2 px-3 font-semibold">Day</th>
                      <th className="py-2 px-3 font-semibold">Hour of Day</th>
                      <th className="py-2 px-3 font-semibold">Hourly Total</th>
                      <th className="py-2 px-3 font-semibold">Daily Total</th>
                      <th className="py-2 px-3 font-semibold">Unit of Measurement</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    <tr className="hover:bg-slate-800/20">
                      <td className="py-1.5 px-3 text-slate-200 font-bold">09/22/2025</td>
                      <td className="py-1.5 px-3 text-emerald-300">12:00 AM</td>
                      <td className="py-1.5 px-3 text-amber-300">1.018</td>
                      <td className="py-1.5 px-3 text-cyan-300">25.075</td>
                      <td className="py-1.5 px-3 text-slate-400">kWh</td>
                    </tr>
                    <tr className="hover:bg-slate-800/20">
                      <td className="py-1.5 px-3 text-slate-200 font-bold">09/22/2025</td>
                      <td className="py-1.5 px-3 text-emerald-300">1:00 AM</td>
                      <td className="py-1.5 px-3 text-amber-300">0.907</td>
                      <td className="py-1.5 px-3 text-cyan-300">25.075</td>
                      <td className="py-1.5 px-3 text-slate-400">kWh</td>
                    </tr>
                    <tr className="hover:bg-slate-800/20">
                      <td className="py-1.5 px-3 text-slate-200 font-bold">09/22/2025</td>
                      <td className="py-1.5 px-3 text-emerald-300">2:00 AM</td>
                      <td className="py-1.5 px-3 text-amber-300">0.958</td>
                      <td className="py-1.5 px-3 text-cyan-300">25.075</td>
                      <td className="py-1.5 px-3 text-slate-400">kWh</td>
                    </tr>
                    <tr className="hover:bg-slate-800/20">
                      <td className="py-1.5 px-3 text-slate-200 font-bold">09/22/2025</td>
                      <td className="py-1.5 px-3 text-emerald-300">3:00 AM</td>
                      <td className="py-1.5 px-3 text-amber-300">0.931</td>
                      <td className="py-1.5 px-3 text-cyan-300">25.075</td>
                      <td className="py-1.5 px-3 text-slate-400">kWh</td>
                    </tr>
                    <tr className="hover:bg-slate-800/20">
                      <td className="py-1.5 px-3 text-slate-200 font-bold">09/22/2025</td>
                      <td className="py-1.5 px-3 text-emerald-300">4:00 AM</td>
                      <td className="py-1.5 px-3 text-amber-300">0.886</td>
                      <td className="py-1.5 px-3 text-cyan-300">25.075</td>
                      <td className="py-1.5 px-3 text-slate-400">kWh</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
                <div>
                  <span className="font-semibold text-slate-300">Date & Hour Format:</span> Accepts <code className="text-slate-300 font-mono">MM/DD/YYYY</code> with 12h AM/PM (e.g. <code className="text-emerald-400 font-mono">12:00 AM</code>, <code className="text-emerald-400 font-mono">1:00 PM</code>) or 24h format.
                </div>
                <div>
                  <span className="font-semibold text-slate-300">Consumption Totals:</span> <code className="text-amber-300 font-mono">Hourly Total</code> represents interval consumption; <code className="text-cyan-300 font-mono">Daily Total</code> represents daily aggregate consumption.
                </div>
                <div>
                  <span className="font-semibold text-slate-300">Measurement Units:</span> Native <code className="text-emerald-400 font-mono">kWh</code>. Sub-units <code className="text-slate-300 font-mono">Wh</code> or <code className="text-slate-300 font-mono">MWh</code> are automatically converted.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Drag & Drop Upload Zone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-slate-800 hover:border-emerald-500/60 bg-slate-900/30 hover:bg-slate-900/50 rounded-xl p-6 text-center cursor-pointer transition-all space-y-2 group"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onFileUpload(e.target.files[0]);
              }
            }}
          />
          <div className="h-10 w-10 mx-auto rounded-full bg-slate-800/80 flex items-center justify-center text-slate-400 group-hover:text-emerald-400 group-hover:bg-emerald-950/50 transition-colors">
            <Upload className="h-5 w-5" />
          </div>
          <div>
            <span className="text-sm font-semibold text-slate-200 group-hover:text-white">
              Click to browse or drop electricity interval CSV
            </span>
            <p className="text-xs text-slate-400 mt-0.5">
              Exact schema required: <code className="text-emerald-400 font-mono">Day, Hour of Day, Hourly Total, Daily Total, Unit of Measurement</code>
            </p>
          </div>
        </div>

        {/* Validation Feedback & Dataset Summary */}
        {csvResult && (
          <div
            className={`p-4 rounded-xl border ${
              csvResult.isValid
                ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
                : 'bg-rose-950/20 border-rose-500/30 text-rose-200'
            }`}
          >
            <div className="flex items-start gap-3">
              {csvResult.isValid ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1 flex-1">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                    <span>
                      {csvResult.isValid
                        ? 'Interval Dataset Validated Successfully'
                        : 'CSV Schema Validation Errors Detected'}
                    </span>
                    {csvResult.isValid && (
                      <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-emerald-900/60 text-emerald-300 border border-emerald-600/40">
                        {csvResult.schemaDetected === 'legacy_2col' ? 'Legacy 2-Col Schema' : '5-Column Utility Schema'}
                      </span>
                    )}
                  </h4>
                  <span className="text-xs font-mono font-bold">
                    {csvResult.validRows.toLocaleString()} intervals parsed
                  </span>
                </div>

                {csvResult.errors.length > 0 && (
                  <ul className="list-disc list-inside text-xs text-rose-300 space-y-0.5 mt-2 bg-rose-950/40 p-2.5 rounded border border-rose-500/20 font-mono">
                    {csvResult.errors.slice(0, 5).map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                    {csvResult.errors.length > 5 && (
                      <li className="list-none text-rose-400 pt-1">
                        ...and {csvResult.errors.length - 5} more issues.
                      </li>
                    )}
                  </ul>
                )}

                {csvResult.warnings.length > 0 && (
                  <div className="mt-2 text-xs text-amber-300/90 bg-amber-950/30 border border-amber-500/20 rounded p-2 space-y-1">
                    {csvResult.warnings.map((warn, wIdx) => (
                      <p key={wIdx}>⚠️ {warn}</p>
                    ))}
                  </div>
                )}

                {csvResult.isValid && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 mt-2 border-t border-emerald-500/20 text-xs font-mono">
                    <div>
                      <span className="text-[10px] text-slate-400 block font-sans">Total Annual Load</span>
                      <span className="text-sm font-bold text-white tabular-nums">
                        {csvResult.totalKwh.toLocaleString()} kWh
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block font-sans">Avg Daily Consumption</span>
                      <span className="text-sm font-bold text-white tabular-nums">
                        {(csvResult.totalKwh / 365).toFixed(1)} kWh/day
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block font-sans">Peak Household Demand</span>
                      <span className="text-sm font-bold text-amber-300 tabular-nums">
                        {csvResult.peakKw.toFixed(2)} kW
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block font-sans">Interval Resolution</span>
                      <span className="text-sm font-bold text-emerald-400 tabular-nums">
                        {csvResult.intervalHours === 1
                          ? 'Hourly (8,760)'
                          : `${csvResult.intervalHours * 60}m sub-hourly`}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Ingested Interval Data Preview Table */}
        {csvResult && csvResult.isValid && csvResult.data.length > 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/30 overflow-hidden space-y-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-2.5 bg-slate-900/70 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <TableIcon className="h-4 w-4 text-emerald-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Ingested Data Preview (5-Column Format)
                </h3>
                <span className="text-[11px] font-mono text-slate-400">
                  Showing first {Math.min(previewRowLimit, csvResult.data.length)} of {csvResult.data.length.toLocaleString()} intervals
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded border border-slate-800">
                  {[24, 48, 96].map((limit) => (
                    <button
                      key={limit}
                      onClick={() => setPreviewRowLimit(limit)}
                      className={`px-2 py-0.5 rounded font-mono text-[10px] transition-colors ${
                        previewRowLimit === limit
                          ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {limit}h
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setShowDataPreview(!showDataPreview)}
                  className="px-2 py-1 text-slate-400 hover:text-slate-200 text-xs flex items-center gap-1"
                >
                  <span>{showDataPreview ? 'Collapse' : 'Expand'}</span>
                  {showDataPreview ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            {showDataPreview && (
              <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="sticky top-0 bg-slate-950/95 border-b border-slate-800 text-slate-400 backdrop-blur z-10">
                    <tr>
                      <th className="py-2 px-3 text-[10px] text-slate-500 font-semibold w-12">#</th>
                      <th className="py-2 px-3 font-semibold text-slate-300">Day</th>
                      <th className="py-2 px-3 font-semibold text-slate-300">Hour of Day</th>
                      <th className="py-2 px-3 font-semibold text-amber-300 text-right">Hourly Total</th>
                      <th className="py-2 px-3 font-semibold text-cyan-300 text-right">Daily Total</th>
                      <th className="py-2 px-3 font-semibold text-slate-400 text-center">Unit of Measurement</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {csvResult.data.slice(0, previewRowLimit).map((pt, idx) => {
                      const dayStr = pt.dayStr || pt.timestamp.split(' ')[0];
                      const hourStr = pt.hourOfDayStr || `${pt.hour}:00`;
                      const hourlyVal = pt.hourlyTotal ?? pt.usageKwh;
                      const dailyVal = pt.dailyTotal ?? 0;
                      const unitStr = pt.unitOfMeasurement || 'kWh';

                      return (
                        <tr key={idx} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-1.5 px-3 text-[10px] text-slate-600">{idx + 1}</td>
                          <td className="py-1.5 px-3 text-slate-200 font-medium">{dayStr}</td>
                          <td className="py-1.5 px-3 text-emerald-400">{hourStr}</td>
                          <td className="py-1.5 px-3 text-right text-amber-300 font-bold tabular-nums">
                            {typeof hourlyVal === 'number' ? hourlyVal.toFixed(3) : hourlyVal}
                          </td>
                          <td className="py-1.5 px-3 text-right text-cyan-300 tabular-nums">
                            {dailyVal > 0 ? dailyVal.toFixed(3) : '—'}
                          </td>
                          <td className="py-1.5 px-3 text-center text-slate-400">
                            <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300">
                              {unitStr}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* SECTION 2: TIME-OF-USE (TOU) RATE CONFIGURATOR & SEASONAL MONTH RANGES */}
      <section className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <span className="text-emerald-400 font-mono text-base">02.</span>
              TOU Rate Profiles, Seasonal Month Pricing & Weekly Schedule
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Define month ranges (e.g. Summer vs. Winter rates), manage price tiers, and assign tiers across the unified 168-hour schedule.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDuplicateTouProfile}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded-lg transition-colors whitespace-nowrap"
              title="Duplicate current TOU rate profile"
            >
              <Copy className="h-3.5 w-3.5 text-slate-400" />
              <span>Duplicate Tariff</span>
            </button>
            <button
              onClick={handleCreateNewTouProfile}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-300 bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/30 rounded-lg transition-colors whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5 text-emerald-400" />
              <span>New TOU Profile</span>
            </button>
            <button
              onClick={handleResetToStandardProfiles}
              className="p-1.5 text-slate-400 hover:text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg transition-colors"
              title="Reset to default library of utility tariffs"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* TOU SAVED PROFILES SELECTOR CARDS */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Bookmark className="h-3.5 w-3.5 text-emerald-400" />
              Saved Rate Profiles ({touProfiles.length} available)
            </span>
            <span className="text-slate-400">
              Click any tariff card to activate it for simulation
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {touProfiles.map((p) => {
              const isActive = p.id === currentTouProfile.id;
              const pSeasons = p.seasons && p.seasons.length > 0 ? p.seasons : [];
              const minBuy = Math.min(...p.tiers.map((t) => t.buyRate));
              const maxBuy = Math.max(...p.tiers.map((t) => t.buyRate));
              const spread = maxBuy - minBuy;

              return (
                <div
                  key={p.id}
                  onClick={() => handleSelectTouProfile(p.id)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                    isActive
                      ? 'border-emerald-500 bg-slate-900 shadow-md ring-1 ring-emerald-500/40'
                      : 'border-slate-800 bg-slate-900/30 hover:bg-slate-900/70'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h4 className="text-xs font-bold text-slate-100 truncate flex items-center gap-1.5">
                          {p.name}
                        </h4>
                        <span className="text-[11px] text-slate-400 block truncate mt-0.5">
                          {p.utility}
                        </span>
                      </div>

                      {touProfiles.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteTouProfile(p.id);
                          }}
                          className="text-slate-500 hover:text-red-400 p-1 transition-colors shrink-0"
                          title="Delete profile"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-400 mt-2 line-clamp-2 leading-relaxed">
                      {p.description}
                    </p>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-slate-800/80 space-y-2">
                    {/* Seasons & Tiers badge summary */}
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-300 font-sans text-[11px] flex items-center gap-1">
                          <Sun className="h-3 w-3 text-amber-400" />
                          {pSeasons.length} {pSeasons.length === 1 ? 'Month Range' : 'Month Ranges'}
                        </span>
                        <span className="text-slate-500">·</span>
                        <span className="text-slate-400 font-sans">{p.tiers.length} tiers</span>
                      </div>

                      <div className="text-slate-300">
                        Spread:{' '}
                        <strong className="text-emerald-400 font-bold">
                          +${spread.toFixed(2)}/kWh
                        </strong>
                      </div>
                    </div>

                    {isActive && (
                      <div className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                        <Check className="h-3 w-3" />
                        <span>Active Tariff for Simulation</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ACTIVE TOU PROFILE METADATA EDITOR */}
        <div className="bg-slate-900/40 rounded-xl border border-slate-800 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Building className="h-3.5 w-3.5 text-cyan-400" />
              Active Tariff Parameters: {currentTouProfile.name}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-medium text-slate-400 block mb-1">
                Tariff Name
              </label>
              <input
                type="text"
                value={currentTouProfile.name}
                onChange={(e) => handleUpdateProfileMeta('name', e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-semibold focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-[11px] font-medium text-slate-400 block mb-1">
                Utility / Energy Market
              </label>
              <input
                type="text"
                value={currentTouProfile.utility}
                onChange={(e) => handleUpdateProfileMeta('utility', e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="text-[11px] font-medium text-slate-400 block mb-1">
                Description / Rule Notes
              </label>
              <input
                type="text"
                value={currentTouProfile.description}
                onChange={(e) => handleUpdateProfileMeta('description', e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SEASONAL MONTH RANGES & PRICING CONFIGURATOR                              */}
        {/* ========================================================================= */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <Sun className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-100">
                  Seasonal Month Ranges & Rate Pricing
                </h3>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Assign calendar months to seasons (e.g. higher peak charges in Summer vs Winter). The weekly tier layout stays constant while pricing adjusts automatically by month.
              </p>
            </div>

            {/* Quick Preset Buttons */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-[11px] text-slate-400 mr-1 font-medium">Presets:</span>
              <button
                onClick={() => handleApplySeasonPreset('summer-winter')}
                className="px-2.5 py-1 text-[11px] font-medium bg-slate-950 hover:bg-slate-800 text-amber-300 border border-amber-500/30 rounded-md transition-colors"
                title="Summer (Jun-Sep) & Winter (Oct-May)"
              >
                Summer / Winter
              </button>
              <button
                onClick={() => handleApplySeasonPreset('three-season')}
                className="px-2.5 py-1 text-[11px] font-medium bg-slate-950 hover:bg-slate-800 text-emerald-300 border border-emerald-500/30 rounded-md transition-colors"
                title="Summer (Jun-Aug), Shoulder (Apr-May, Sep-Oct), Winter (Nov-Feb)"
              >
                3-Season
              </button>
              <button
                onClick={() => handleApplySeasonPreset('quarterly')}
                className="px-2.5 py-1 text-[11px] font-medium bg-slate-950 hover:bg-slate-800 text-cyan-300 border border-cyan-500/30 rounded-md transition-colors"
                title="4 Quarters: Q1, Q2, Q3, Q4"
              >
                Quarterly
              </button>
              <button
                onClick={() => handleApplySeasonPreset('uniform')}
                className="px-2.5 py-1 text-[11px] font-medium bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-md transition-colors"
                title="Single uniform year-round pricing"
              >
                Year-Round
              </button>
            </div>
          </div>

          {/* 12-Month Interactive Calendar Ribbon */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-emerald-400" />
                12-Month Calendar Schedule Allocation
              </span>
              <span className="text-slate-400 text-[11px]">
                Click any month to assign or toggle it for the active month range ({currentActiveSeason?.name})
              </span>
            </div>

            <div className="grid grid-cols-6 sm:grid-cols-12 gap-1.5 select-none">
              {MONTH_SHORT.map((monthName, monthIdx) => {
                // Determine which season currently owns this month
                const ownerSeason = seasons.find((s) => s.months.includes(monthIdx));
                const ownerIdx = ownerSeason ? seasons.indexOf(ownerSeason) : -1;
                const theme = ownerIdx >= 0 ? SEASON_THEMES[ownerIdx % SEASON_THEMES.length] : null;
                const isSelectedInActive = currentActiveSeason?.months.includes(monthIdx);

                return (
                  <button
                    key={monthIdx}
                    type="button"
                    onClick={() => currentActiveSeason && handleToggleMonthInSeason(currentActiveSeason.id, monthIdx)}
                    className={`flex flex-col items-center justify-center p-2 rounded-lg border transition-all cursor-pointer ${
                      isSelectedInActive
                        ? `${theme?.activeBg || 'bg-amber-950/40'} ${theme?.activeBorder || 'border-amber-400'} ring-1 ring-amber-500/40 shadow-sm scale-105`
                        : ownerSeason
                        ? `${theme?.bg} ${theme?.border} hover:scale-102 opacity-85`
                        : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700 text-slate-500'
                    }`}
                    title={`${MONTH_FULL[monthIdx]}: Assigned to ${ownerSeason?.name || 'None'}. Click to toggle for ${currentActiveSeason?.name}.`}
                  >
                    <span
                      className={`text-xs font-bold font-mono ${
                        isSelectedInActive ? 'text-white' : ownerSeason ? theme?.text : 'text-slate-400'
                      }`}
                    >
                      {monthName}
                    </span>
                    <span
                      className={`text-[9px] font-sans truncate max-w-full px-1 mt-1 rounded ${
                        isSelectedInActive
                          ? 'bg-amber-500 text-slate-950 font-bold'
                          : ownerSeason
                          ? `${theme?.bg} ${theme?.text} font-medium`
                          : 'text-slate-600'
                      }`}
                    >
                      {ownerSeason ? ownerSeason.name.split(' ')[0] : 'Unset'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Month Range Tabs & Active Editor */}
          <div className="space-y-4 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2">
              <div className="flex flex-wrap items-center gap-2">
                {seasons.map((season, idx) => {
                  const isActive = season.id === currentActiveSeason?.id;
                  const theme = SEASON_THEMES[idx % SEASON_THEMES.length];
                  const Icon = theme.icon;

                  return (
                    <button
                      key={season.id}
                      onClick={() => setActiveSeasonId(season.id)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        isActive
                          ? `${theme.activeBg} ${theme.text} border ${theme.activeBorder} shadow-sm ring-1 ring-white/10`
                          : 'bg-slate-950/70 text-slate-400 border border-slate-800 hover:text-slate-200'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span>{season.name}</span>
                      <span className="font-mono text-[10px] px-1.5 py-0.2 bg-slate-950/80 rounded border border-white/10">
                        {season.months.length} mo
                      </span>
                    </button>
                  );
                })}

                <button
                  onClick={handleAddSeason}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-950/30 hover:bg-emerald-900/40 border border-emerald-500/30 rounded-lg transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Month Range</span>
                </button>
              </div>

              {seasons.length > 1 && currentActiveSeason && (
                <button
                  onClick={() => handleDeleteSeason(currentActiveSeason.id)}
                  className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 px-2 py-1 rounded transition-colors"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>Delete This Range</span>
                </button>
              )}
            </div>

            {/* Active Season Config Strip */}
            {currentActiveSeason && (
              <div className="bg-slate-950/70 rounded-xl border border-slate-800/80 p-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex-1 max-w-sm">
                    <label className="text-[11px] font-medium text-slate-400 block mb-1">
                      Month Range Name
                    </label>
                    <input
                      type="text"
                      value={currentActiveSeason.name}
                      onChange={(e) => handleUpdateSeasonName(currentActiveSeason.id, e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-semibold focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div className="text-xs text-slate-400">
                    <span className="font-semibold text-slate-300">Months in this range: </span>
                    {currentActiveSeason.months.length > 0 ? (
                      <span className="text-emerald-400 font-mono font-medium">
                        {currentActiveSeason.months.map((m) => MONTH_SHORT[m]).join(', ')} ({currentActiveSeason.months.length} months)
                      </span>
                    ) : (
                      <span className="text-amber-400 italic">No months assigned yet (click months above)</span>
                    )}
                  </div>
                </div>

                {/* Seasonal Rates for this Month Range */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                      <ArrowUpDown className="h-3.5 w-3.5 text-amber-400" />
                      Tariff Pricing for {currentActiveSeason.name}
                    </span>
                    <span className="text-slate-400 text-[11px]">
                      Specify the Buy and Sell rates applied during this season's months
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {tiers.map((tier) => {
                      const seasonRate = currentActiveSeason.tierRates?.[tier.id] || {
                        buyRate: tier.buyRate,
                        sellRate: tier.sellRate,
                      };

                      // Compare to first season or base tier to show differential
                      const baseSeason = seasons.find((s) => s.id !== currentActiveSeason.id);
                      const baseRate = baseSeason?.tierRates?.[tier.id]?.buyRate ?? tier.buyRate;
                      const diff = seasonRate.buyRate - baseRate;

                      return (
                        <div
                          key={tier.id}
                          className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 space-y-2.5"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{ backgroundColor: tier.color }}
                              />
                              <span className="text-xs font-bold text-slate-200 truncate">
                                {tier.name}
                              </span>
                            </div>

                            {baseSeason && Math.abs(diff) >= 0.005 && (
                              <span
                                className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                                  diff > 0
                                    ? 'text-amber-400 bg-amber-950/50 border border-amber-500/20'
                                    : 'text-cyan-400 bg-cyan-950/50 border border-cyan-500/20'
                                }`}
                                title={`Compared to ${baseSeason.name} ($${baseRate.toFixed(2)}/kWh)`}
                              >
                                {diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)}/kWh
                              </span>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
                              <span className="text-[10px] text-slate-400 block">Buy Rate</span>
                              <div className="flex items-center text-slate-100 font-mono mt-0.5">
                                <span className="text-slate-500 mr-0.5">$</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={seasonRate.buyRate}
                                  onChange={(e) =>
                                    handleUpdateSeasonTierRate(
                                      currentActiveSeason.id,
                                      tier.id,
                                      'buyRate',
                                      parseFloat(e.target.value) || 0
                                    )
                                  }
                                  className="w-full bg-transparent font-bold text-amber-300 focus:outline-none tabular-nums text-xs"
                                />
                                <span className="text-[10px] text-slate-500 ml-0.5">/kWh</span>
                              </div>
                            </div>

                            <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80">
                              <span className="text-[10px] text-slate-400 block">Feed-in (Sell)</span>
                              <div className="flex items-center text-slate-100 font-mono mt-0.5">
                                <span className="text-slate-500 mr-0.5">$</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={seasonRate.sellRate}
                                  onChange={(e) =>
                                    handleUpdateSeasonTierRate(
                                      currentActiveSeason.id,
                                      tier.id,
                                      'sellRate',
                                      parseFloat(e.target.value) || 0
                                    )
                                  }
                                  className="w-full bg-transparent font-bold text-cyan-300 focus:outline-none tabular-nums text-xs"
                                />
                                <span className="text-[10px] text-slate-500 ml-0.5">/kWh</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Side-by-Side Comparison Matrix */}
            <div className="bg-slate-950/50 rounded-xl border border-slate-800/80 p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                  Side-by-Side Seasonal Price Comparison
                </span>
                <span className="text-slate-400 text-[11px]">
                  Simultaneous view of all tiers across defined month ranges
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                      <th className="py-2 pr-4 font-sans">Rate Tier</th>
                      {seasons.map((s, idx) => (
                        <th key={s.id} className="py-2 px-3 font-sans">
                          <div className="flex items-center gap-1 text-slate-200">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                SEASON_THEMES[idx % SEASON_THEMES.length].badge
                              }`}
                            />
                            <span>{s.name}</span>
                          </div>
                          <span className="text-[10px] text-slate-400 block font-normal">
                            {s.months.length} months
                          </span>
                        </th>
                      ))}
                      {seasons.length >= 2 && (
                        <th className="py-2 pl-3 font-sans text-right">Seasonal Differential</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {tiers.map((tier) => {
                      const rates = seasons.map(
                        (s) =>
                          s.tierRates?.[tier.id] || {
                            buyRate: tier.buyRate,
                            sellRate: tier.sellRate,
                          }
                      );
                      const minBuy = Math.min(...rates.map((r) => r.buyRate));
                      const maxBuy = Math.max(...rates.map((r) => r.buyRate));
                      const delta = maxBuy - minBuy;

                      return (
                        <tr key={tier.id} className="hover:bg-slate-900/40 transition-colors">
                          <td className="py-2 pr-4 font-sans font-medium text-slate-200 flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: tier.color }}
                            />
                            <span>{tier.name}</span>
                          </td>

                          {rates.map((r, idx) => (
                            <td key={idx} className="py-2 px-3">
                              <span className="text-emerald-400 font-bold">
                                ${r.buyRate.toFixed(2)}
                              </span>
                              <span className="text-[10px] text-slate-500 ml-1">
                                (Sell: ${r.sellRate.toFixed(2)})
                              </span>
                            </td>
                          ))}

                          {seasons.length >= 2 && (
                            <td className="py-2 pl-3 text-right">
                              {delta > 0.001 ? (
                                <span className="text-amber-300 font-bold">
                                  +${delta.toFixed(2)}/kWh (+{Math.round((delta / (minBuy || 0.01)) * 100)}%)
                                </span>
                              ) : (
                                <span className="text-slate-500">Flat across year</span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Rate Tiers Palette & Active Paintbrush */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Paintbrush className="h-3.5 w-3.5 text-emerald-400" />
                Schedule Matrix Paintbrush Tiers
              </span>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Select a tier to paint the 168-hour weekly grid. Colors assign time periods to tier definitions.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleAddTier}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-400 bg-emerald-950/40 hover:bg-emerald-900/40 border border-emerald-500/30 rounded-lg transition-colors"
              >
                <Plus className="h-3 w-3" />
                <span>Add Custom Tier</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {tiers.map((tier) => {
              const isSelected = activeTierId === tier.id;
              return (
                <div
                  key={tier.id}
                  onClick={() => setActiveTierId(tier.id)}
                  className={`relative p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-emerald-500/80 bg-slate-900 shadow-md ring-1 ring-emerald-500/50'
                      : 'border-slate-800 bg-slate-900/40 hover:bg-slate-900/80'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
                        style={{ backgroundColor: tier.color }}
                      />
                      <input
                        type="text"
                        value={tier.name}
                        onChange={(e) => handleUpdateTier(tier.id, 'name', e.target.value)}
                        className="bg-transparent text-xs font-bold text-slate-100 focus:outline-none focus:border-b border-emerald-500 max-w-[130px]"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                    {tiers.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteTier(tier.id);
                        }}
                        className="text-slate-500 hover:text-red-400 transition-colors p-1"
                        title="Delete tier"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
                    <div className="bg-slate-950/60 rounded-md p-2 border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 block font-medium">Base Buy Rate</span>
                      <div className="flex items-center text-slate-200 font-mono mt-0.5">
                        <span className="text-slate-400 mr-0.5">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={tier.buyRate}
                          onChange={(e) =>
                            handleUpdateTier(tier.id, 'buyRate', parseFloat(e.target.value) || 0)
                          }
                          className="bg-transparent w-full text-xs font-semibold focus:outline-none text-emerald-400 tabular-nums"
                        />
                        <span className="text-[10px] text-slate-500 ml-0.5">/kWh</span>
                      </div>
                    </div>

                    <div className="bg-slate-950/60 rounded-md p-2 border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 block font-medium">Feed-in (Sell)</span>
                      <div className="flex items-center text-slate-200 font-mono mt-0.5">
                        <span className="text-slate-400 mr-0.5">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={tier.sellRate}
                          onChange={(e) =>
                            handleUpdateTier(tier.id, 'sellRate', parseFloat(e.target.value) || 0)
                          }
                          className="bg-transparent w-full text-xs font-semibold focus:outline-none text-cyan-400 tabular-nums"
                        />
                        <span className="text-[10px] text-slate-500 ml-0.5">/kWh</span>
                      </div>
                    </div>
                  </div>

                  {isSelected && (
                    <div className="mt-2 text-[10px] text-emerald-400 font-medium flex items-center gap-1">
                      <Paintbrush className="h-3 w-3" />
                      <span>Active brush (Click or drag grid below to paint)</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 7-DAY 24-HOUR MATRIX EDITOR */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:p-5 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-200">
                  Unified Weekly 168-Hour Schedule Matrix
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-500/30">
                  Same Layout Across All Months
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                The weekly schedule pattern remains the same throughout the year. The pricing for each tier changes dynamically based on the active month ranges defined above.
              </p>
            </div>

            {/* Quick Paint & Preview season toggle */}
            <div className="flex flex-wrap items-center gap-2">
              {seasons.length > 1 && (
                <div className="flex items-center gap-1.5 mr-2">
                  <span className="text-slate-400 text-[11px]">Preview Rates:</span>
                  <select
                    value={matrixPreviewSeasonId || currentActiveSeason?.id}
                    onChange={(e) => setMatrixPreviewSeasonId(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-amber-300 focus:outline-none"
                  >
                    {seasons.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <span className="text-slate-400 mr-1 text-[11px]">Quick Paint:</span>
              <button
                onClick={() => applyBulkSchedule('weekdays-peak')}
                className="px-2 py-1 text-[11px] font-medium text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded transition-colors"
                title="Paint Weekday 4-9 PM slots with active brush"
              >
                Paint 4-9pm Peak
              </button>
              <button
                onClick={() => applyBulkSchedule('all-super-offpeak-night')}
                className="px-2 py-1 text-[11px] font-medium text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded transition-colors"
                title="Paint 0-6 AM slots with active brush"
              >
                Paint 0-6am Night
              </button>
              <button
                onClick={() => applyBulkSchedule('fill-active')}
                className="px-2 py-1 text-[11px] font-medium text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded transition-colors"
                title="Fill all 168 hours with active brush"
              >
                Fill All
              </button>
              <button
                onClick={() => applyBulkSchedule('reset-california')}
                className="px-2 py-1 text-[11px] font-medium text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded transition-colors"
              >
                Reset CA Layout
              </button>
            </div>
          </div>

          {/* Matrix Container */}
          <div className="overflow-x-auto select-none pb-2">
            <div className="min-w-[820px]">
              {/* Hour header */}
              <div
                className="gap-1 mb-1.5 text-[10px] font-mono text-slate-400 text-center"
                style={{ display: 'grid', gridTemplateColumns: '100px repeat(24, minmax(0, 1fr))' }}
              >
                <div className="text-left font-sans text-slate-400 pl-1">Day / Hour</div>
                {Array.from({ length: 24 }).map((_, h) => (
                  <div key={h} className="truncate">
                    {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
                  </div>
                ))}
              </div>

              {/* Day rows (Mon to Sun UI presentation, translating to canonical 0=Sun..6=Sat) */}
              <div className="space-y-1.5">
                {UI_DAY_NAMES.map((dayName, uiRowIdx) => {
                  const canonicalDow = uiRowIndexToDayOfWeek(uiRowIdx);
                  return (
                    <div
                      key={canonicalDow}
                      className="gap-1 items-center"
                      style={{ display: 'grid', gridTemplateColumns: '100px repeat(24, minmax(0, 1fr))' }}
                    >
                      <span className="text-xs font-semibold text-slate-300 truncate pl-1">
                        {dayName}
                      </span>
                      {Array.from({ length: 24 }).map((_, hour) => {
                        const tierId = scheduleMatrix[canonicalDow]?.[hour] || tiers[0]?.id;
                        const cellTier = tiers.find((t) => t.id === tierId) || tiers[0];
                        const isHovered = dragOverCell?.day === canonicalDow && dragOverCell?.hour === hour;

                        const seasonalRate =
                          matrixPreviewSeason?.tierRates?.[cellTier.id] || {
                            buyRate: cellTier.buyRate,
                            sellRate: cellTier.sellRate,
                          };

                        return (
                          <button
                            key={hour}
                            type="button"
                            onMouseDown={() => handleMouseDownCell(canonicalDow, hour)}
                            onMouseEnter={() => handleMouseEnterCell(canonicalDow, hour)}
                            title={`${dayName} ${hour}:00 - ${cellTier.name}\n${matrixPreviewSeason.name} Rates:\nBuy: $${seasonalRate.buyRate.toFixed(2)}/kWh\nSell: $${seasonalRate.sellRate.toFixed(2)}/kWh`}
                            className="h-7 rounded transition-transform hover:scale-105 active:scale-95 focus:outline-none flex items-center justify-center text-[10px] font-mono font-medium shadow-xs"
                            style={{
                              backgroundColor: cellTier.color,
                              opacity: isHovered ? 0.95 : 0.82,
                              color: '#0f172a',
                            }}
                          >
                            <span className="opacity-0 hover:opacity-100 text-[9px] font-bold">
                              {hour}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Matrix Legend */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-800/80 text-xs text-slate-400">
            <div className="flex flex-wrap items-center gap-4">
              <span className="font-semibold text-slate-300">Active Brush:</span>
              <div className="flex items-center gap-1.5">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: activeTier.color }}
                />
                <span className="font-semibold text-slate-200">{activeTier.name}</span>
                <span className="font-mono text-emerald-400 font-bold">
                  (
                  {matrixPreviewSeason.name}: $
                  {(
                    matrixPreviewSeason?.tierRates?.[activeTier.id]?.buyRate ??
                    activeTier.buyRate
                  ).toFixed(2)}
                  /kWh)
                </span>
              </div>
            </div>
            <span className="text-slate-400">
              Click any cell or click-and-drag across rows to assign hours to the active brush tier.
            </span>
          </div>
        </div>
      </section>
    </div>
  );
};
