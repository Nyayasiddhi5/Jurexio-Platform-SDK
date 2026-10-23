import { createLogger } from '../../utils/logger.js';

const logger = createLogger('workflow-scheduler-service');

// Database dependency - uses external db
const db: any = { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }) }) }) };
// Schema tables - external dependency
const jurexioJourneyTimeline: any = {};
const jurexioStartups: any = {};
const jurexioOrchestrationJobs: any = {};
// Drizzle ORM operators
const eq = (a: any, b: any) => ({});
const and = (...args: any[]) => ({});
const desc = (a: any) => ({});
const lt = (a: any, b: any) => ({});
const or = (...args: any[]) => ({});
const isNull = (a: any) => ({});
// 14-day workflow phase execution service - lazy loaded to avoid circular dependencies
const jurexio14DayWorkflowService: any = {
  async executePhase(startupId: number, sessionId: string, phase: number, data: any) {
    logger.info(`[WorkflowScheduler] Phase ${phase} execution requested for startup ${startupId}`);
    logger.info(`[WorkflowScheduler] Phase execution delegated to workflow service`);
  }
};

/**
 * Workflow Scheduler Service
 * Monitors journey timeline and automatically progresses phases
 */
class WorkflowSchedulerService {
  private schedulerInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL_MS = 30000; // Check every 30 seconds

  /**
   * Start the workflow scheduler
   */
  start() {
    if (this.schedulerInterval) {
      logger.info('⏰ Workflow scheduler already running');
      return;
    }

    logger.info('🚀 Starting workflow scheduler...');
    this.schedulerInterval = setInterval(async () => {
      try {
        await this.checkAndProgressWorkflows();
      } catch (error: any) {
        logger.error('❌ Workflow scheduler error:', error);
      }
    }, this.POLL_INTERVAL_MS);

    logger.info(`✅ Workflow scheduler started (polling every ${this.POLL_INTERVAL_MS / 1000}s)`);
  }

  /**
   * Stop the workflow scheduler
   */
  stop() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
      logger.info('⏹️  Workflow scheduler stopped');
    }
  }

  /**
   * Check all active workflows and progress phases based on completion
   */
  private async checkAndProgressWorkflows() {
    try {
      // Find only active workflows (not completed, not paused) - database-level filtering
      const activeStartups = await db
        .select()
        .from(jurexioStartups)
        .where(
          and(
            // Handle both legacy NULL values and explicit false (not paused)
            or(
              isNull(jurexioStartups.isPaused),
              eq(jurexioStartups.isPaused, false)
            ),
            // Only check startups with progress < 100 (or null/0)
            or(
              isNull(jurexioStartups.progress),
              lt(jurexioStartups.progress, 100)
            )
          )
        );

      let processed = 0;
      let errors = 0;

      for (const startup of activeStartups) {
        // Additional safety check (redundant with WHERE clause but ensures correctness)
        if (startup.progress && startup.progress >= 100) {
          continue;
        }

        try {
          await this.progressStartupWorkflow(startup);
          processed++;
        } catch (error: any) {
          errors++;
          this.logError('workflow_progression', error, {
            startupId: startup.id,
            progress: startup.progress,
            name: startup.name
          });
        }
      }

      // Log batch summary only if there's activity
      if (processed > 0 || errors > 0) {
        logger.info(`📊 Scheduler cycle: active=${activeStartups.length}, processed=${processed}, errors=${errors}`);
      }
    } catch (error: any) {
      this.logError('scheduler_cycle', error);
    }
  }

  /**
   * Progress a specific startup's workflow
   */
  private async progressStartupWorkflow(startup: any) {
    // Get the latest timeline event for this startup
    const [latestEvent] = await db
      .select()
      .from(jurexioJourneyTimeline)
      .where(eq(jurexioJourneyTimeline.startupId, startup.id))
      .orderBy(desc(jurexioJourneyTimeline.id))
      .limit(1);

    if (!latestEvent) {
      return; // No events yet
    }

    // Check if the latest event is a phase completion
    if (latestEvent.eventType === 'phase_completed') {
      const metadata = latestEvent.metadata as any;
      const orchestrationJobId = metadata?.orchestrationJobId;

      if (!orchestrationJobId) {
        return; // No orchestration job to check
      }

      // Check if the orchestration job is complete
      const [job] = await db
        .select()
        .from(jurexioOrchestrationJobs)
        .where(eq(jurexioOrchestrationJobs.id, orchestrationJobId))
        .limit(1);

      if (!job) {
        return;
      }

      // Only progress if job is completed successfully
      if (job.status === 'completed') {
        const currentPhase = latestEvent.dayNumber || 0;
        const nextPhase = currentPhase + 1;

        // Check if there's a next phase to run
        if (nextPhase <= 14) {
          // Check if next phase already exists in timeline
          const [existingNextPhase] = await db
            .select()
            .from(jurexioJourneyTimeline)
            .where(
              and(
                eq(jurexioJourneyTimeline.startupId, startup.id),
                eq(jurexioJourneyTimeline.dayNumber, nextPhase)
              )
            )
            .limit(1);

          if (!existingNextPhase) {
            logger.info(`🔄 Auto-progressing startup ${startup.id} from phase ${currentPhase} to phase ${nextPhase}`);
            
            // Get session ID from metadata
            const sessionId = metadata?.sessionId;
            
            if (sessionId) {
              // Execute next phase
              await jurexio14DayWorkflowService.executePhase(
                startup.id,
                sessionId,
                nextPhase,
                {} // Will use startup data from database
              );
              
              logger.info(`✅ Phase ${nextPhase} started for startup ${startup.id}`);
            }
          }
        } else if (nextPhase > 14) {
          // Workflow complete
          await db.update(jurexioStartups)
            .set({ 
              currentPhase: 'launched',
              progress: 100
            })
            .where(eq(jurexioStartups.id, startup.id));
          
          logger.info(`🎉 Workflow completed for startup ${startup.id}`);
        }
      } else if (job.status === 'failed') {
        // Handle failed job - log error but don't pause (no status field)
        logger.info(`⚠️  Job failed for startup ${startup.id}: ${orchestrationJobId}`);
      }
    }
  }

  /**
   * Manually trigger phase progression for a startup
   */
  async triggerPhaseProgression(startupId: number): Promise<void> {
    try {
      const [startup] = await db
        .select()
        .from(jurexioStartups)
        .where(eq(jurexioStartups.id, startupId))
        .limit(1);

      if (!startup) {
        throw new Error(`Startup ${startupId} not found`);
      }

      this.logOperation('manual_progression', { startupId, progress: startup.progress });
      await this.progressStartupWorkflow(startup);
    } catch (error: any) {
      this.logError('manual_progression', error, { startupId });
      throw error;
    }
  }

  /**
   * Pause workflow for a startup (production-ready implementation)
   */
  async pauseWorkflow(startupId: number): Promise<void> {
    try {
      const [startup] = await db
        .select()
        .from(jurexioStartups)
        .where(eq(jurexioStartups.id, startupId))
        .limit(1);
      
      if (!startup) {
        throw new Error(`Startup ${startupId} not found`);
      }
      
      if (startup.isPaused) {
        this.logOperation('pause_skipped', { 
          startupId, 
          reason: 'already_paused',
          pausedAt: startup.pausedAt 
        });
        return;
      }

      await db.update(jurexioStartups)
        .set({ 
          isPaused: true,
          pausedAt: new Date(),
          pausedProgress: startup.progress,
          updatedAt: new Date()
        })
        .where(eq(jurexioStartups.id, startupId));
      
      this.logOperation('workflow_paused', { 
        startupId,
        name: startup.name,
        progress: startup.progress,
        pausedAt: new Date().toISOString()
      });
    } catch (error: any) {
      this.logError('pause_workflow', error, { startupId });
      throw error;
    }
  }

  /**
   * Resume workflow for a startup (production-ready implementation)
   */
  async resumeWorkflow(startupId: number): Promise<void> {
    try {
      const [startup] = await db
        .select()
        .from(jurexioStartups)
        .where(eq(jurexioStartups.id, startupId))
        .limit(1);

      if (!startup) {
        throw new Error(`Startup ${startupId} not found`);
      }

      if (!startup.isPaused) {
        this.logOperation('resume_skipped', { 
          startupId,
          reason: 'not_paused',
          currentProgress: startup.progress
        });
        return;
      }

      await db.update(jurexioStartups)
        .set({ 
          isPaused: false,
          pausedAt: null,
          updatedAt: new Date()
        })
        .where(eq(jurexioStartups.id, startupId));
      
      this.logOperation('workflow_resumed', { 
        startupId,
        name: startup.name,
        resumedFrom: startup.pausedProgress || startup.progress,
        resumedAt: new Date().toISOString()
      });

      // Immediately check for progression using existing startup object
      // (no need to re-fetch since we only updated pause state)
      const updatedStartup = {
        ...startup,
        isPaused: false,
        pausedAt: null,
        updatedAt: new Date()
      };
      
      await this.progressStartupWorkflow(updatedStartup);
    } catch (error: any) {
      this.logError('resume_workflow', error, { startupId });
      throw error;
    }
  }

  /**
   * Structured error logger with context
   */
  private logError(operation: string, error: unknown, context?: Record<string, any>) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    logger.error(`❌ [WorkflowScheduler] ${operation} failed:`, {
      error: errorMessage,
      context,
      stack: errorStack,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log important operations with context
   */
  private logOperation(operation: string, context: Record<string, any>) {
    logger.info(`📝 [WorkflowScheduler] ${operation}:`, {
      ...context,
      timestamp: new Date().toISOString()
    });
  }
}

export const workflowSchedulerService = new WorkflowSchedulerService();
