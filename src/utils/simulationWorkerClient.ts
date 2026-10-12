import {
  attachGenerationProjection,
  SimulationJobInput,
  SimulationJobResult,
  SimulationWorkerRequestMessage,
  SimulationWorkerResponseMessage,
} from './simulationWorkerJob';

export interface SimulationWorkerLike {
  onmessage: ((event: MessageEvent<SimulationWorkerResponseMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: SimulationWorkerRequestMessage): void;
  terminate(): void;
}

export type SimulationRunResult =
  | { status: 'completed'; requestId: number; result: SimulationJobResult }
  | { status: 'cancelled'; requestId: number }
  | { status: 'error'; requestId: number; message: string };

export interface SimulationTaskHandle {
  requestId: number;
  promise: Promise<SimulationRunResult>;
  cancel: () => void;
}

interface ActiveTask {
  requestId: number;
  worker: SimulationWorkerLike | null;
  cancelCurrentStage: (() => void) | null;
  resolve: (value: SimulationRunResult) => void;
  onProgress?: (percent: number, stage: string) => void;
}

function browserWorkerFactory(): SimulationWorkerLike {
  return new Worker(new URL('../workers/simulation.worker.ts', import.meta.url), { type: 'module' });
}

/** Runs interval work and isolates each generation projection year in a short-lived worker. */
export function createSimulationWorkerClient(
  workerFactory: () => SimulationWorkerLike = browserWorkerFactory
) {
  let latestRequestId = 0;
  let activeTask: ActiveTask | null = null;

  const cancelTask = (task: ActiveTask) => {
    if (activeTask !== task) return;
    activeTask = null;
    task.worker?.terminate();
    task.worker = null;
    task.cancelCurrentStage?.();
    task.resolve({ status: 'cancelled', requestId: task.requestId });
  };

  const finish = (task: ActiveTask, result: SimulationRunResult) => {
    if (activeTask !== task) return;
    activeTask = null;
    task.worker?.terminate();
    task.worker = null;
    task.resolve(result);
  };

  const runStage = (task: ActiveTask, message: SimulationWorkerRequestMessage) =>
    new Promise<SimulationWorkerResponseMessage | null>((resolve) => {
      if (activeTask !== task) {
        resolve(null);
        return;
      }
      let settled = false;
      let worker: SimulationWorkerLike;
      try {
        worker = workerFactory();
      } catch (error) {
        resolve({
          type: 'error',
          requestId: task.requestId,
          message: error instanceof Error ? error.message : 'Simulation worker could not be started.',
        });
        return;
      }
      task.worker = worker;
      const settle = (response: SimulationWorkerResponseMessage | null) => {
        if (settled) return;
        settled = true;
        worker.terminate();
        if (task.worker === worker) task.worker = null;
        if (task.cancelCurrentStage === cancelCurrentStage) task.cancelCurrentStage = null;
        resolve(response);
      };
      const cancelCurrentStage = () => settle(null);
      task.cancelCurrentStage = cancelCurrentStage;
      worker.onmessage = ({ data }) => {
        if (activeTask !== task || data.requestId !== task.requestId) return;
        if (data.type === 'progress') {
          task.onProgress?.(data.percent, data.stage);
        } else {
          settle(data);
        }
      };
      worker.onerror = ({ message: error }) => settle({ type: 'error', requestId: task.requestId, message: error || 'Simulation worker failed.' });
      try {
        worker.postMessage(message);
      } catch (error) {
        settle({
          type: 'error',
          requestId: task.requestId,
          message: error instanceof Error ? error.message : 'Simulation request could not be sent to its worker.',
        });
      }
    });

  const completeProjection = async (task: ActiveTask, input: SimulationJobInput, result: SimulationJobResult) => {
    const years = [];
    task.onProgress?.(56, 'projecting generation lifecycle (year 1 of 25)');
    for (let year = 1; year <= 25; year += 1) {
      if (activeTask !== task) return;
      const response = await runStage(task, { type: 'projection-year', requestId: task.requestId, input, year });
      if (activeTask !== task || !response) return;
      if (response.type === 'error') {
        result.generationProjectionError = response.message;
        task.onProgress?.(100, 'generation projection unavailable');
        finish(task, { status: 'completed', requestId: task.requestId, result });
        return;
      }
      if (response.type !== 'projection-year') {
        finish(task, { status: 'error', requestId: task.requestId, message: 'Simulation worker returned an unexpected projection response.' });
        return;
      }
      years.push(response.year);
      const percent = 55 + Math.round((year / 25) * 37);
      task.onProgress?.(percent, `projecting generation lifecycle (year ${year} of 25)`);
    }

    try {
      task.onProgress?.(95, 'calculating lifecycle finance');
      attachGenerationProjection(result, input, years);
      task.onProgress?.(100, 'complete');
      finish(task, { status: 'completed', requestId: task.requestId, result });
    } catch (error) {
      finish(task, {
        status: 'error',
        requestId: task.requestId,
        message: error instanceof Error ? error.message : 'Generation finance calculation failed.',
      });
    }
  };

  return {
    run(input: SimulationJobInput, onProgress?: (percent: number, stage: string) => void): SimulationTaskHandle {
      if (activeTask) cancelTask(activeTask);
      const requestId = ++latestRequestId;
      let resolveTask!: (value: SimulationRunResult) => void;
      const promise = new Promise<SimulationRunResult>((resolve) => { resolveTask = resolve; });
      const task: ActiveTask = { requestId, worker: null, cancelCurrentStage: null, resolve: resolveTask, onProgress };
      activeTask = task;

      void runStage(task, { type: 'run', requestId, input }).then((response) => {
        if (activeTask !== task || !response) return;
        if (response.type === 'error') {
          finish(task, { status: 'error', requestId, message: response.message });
          return;
        }
        if (response.type !== 'success') {
          finish(task, { status: 'error', requestId, message: 'Simulation worker returned an unexpected response.' });
          return;
        }
        const result = response.result;
        if (input.annualProjectionEligible && result.activeUnifiedResult?.mode === 'generation-aware') {
          void completeProjection(task, input, result);
        } else {
          onProgress?.(100, 'complete');
          finish(task, { status: 'completed', requestId, result });
        }
      });

      return { requestId, promise, cancel: () => cancelTask(task) };
    },
    cancel(): void {
      if (activeTask) cancelTask(activeTask);
    },
    getLatestRequestId(): number {
      return latestRequestId;
    },
  };
}
