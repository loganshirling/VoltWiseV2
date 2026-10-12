import { executeGenerationProjectionYear, executeSimulationJob, SimulationWorkerRequestMessage, SimulationWorkerResponseMessage } from '../utils/simulationWorkerJob';

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<SimulationWorkerRequestMessage>) => void): void;
  postMessage(message: SimulationWorkerResponseMessage): void;
}

const scope = self as unknown as WorkerScope;

scope.addEventListener('message', ({ data }) => {
  try {
    if (data.type === 'run') {
      const result = executeSimulationJob(data.input, (percent, stage) => {
        scope.postMessage({ type: 'progress', requestId: data.requestId, percent, stage });
      });
      scope.postMessage({ type: 'success', requestId: data.requestId, result });
    } else {
      const year = executeGenerationProjectionYear(data.input, data.year);
      scope.postMessage({ type: 'projection-year', requestId: data.requestId, year });
    }
  } catch (error) {
    scope.postMessage({
      type: 'error',
      requestId: data.requestId,
      message: error instanceof Error ? error.message : 'Simulation worker failed.',
    });
  }
});
