package crond

import (
	"context"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/robfig/cron/v3"
)

const defaultJobCron = "* * * * *"

type scheduledJob struct {
	entryID    cron.EntryID
	expression string
	projectID  string
}

// Validation, previews and execution share the same five-field/descriptor parser.
func parseJobSchedule(expression string) (cron.Schedule, error) {
	if expression == "" {
		expression = defaultJobCron
	}
	schedule, err := cron.ParseStandard(expression)
	if err != nil {
		return nil, fmt.Errorf("无效的 Cron 表达式: %w", err)
	}
	return schedule, nil
}

func (s *Service) reschedule() error {
	s.scheduleMu.Lock()
	defer s.scheduleMu.Unlock()
	var docs []Document
	if err := s.db.Where("kind = ?", "jobs").Find(&docs).Error; err != nil {
		return err
	}
	if s.scheduledJobs == nil {
		s.scheduledJobs = make(map[string]scheduledJob)
	}
	active := make(map[string]bool)
	for _, doc := range docs {
		job := decode(doc)
		if str(job, "status") != "active" {
			continue
		}
		project, id := doc.ProjectID, doc.ID
		active[id] = true
		expression := str(job, "cronExp")
		previous, exists := s.scheduledJobs[id]
		// Preserve the next deadline when only task content or other jobs change.
		if exists && previous.expression == expression && previous.projectID == project {
			continue
		}
		schedule, err := parseJobSchedule(expression)
		if err != nil {
			return err
		}
		entryID := s.scheduler.Schedule(schedule, cron.FuncJob(func() {
			_, _ = s.executeStored(context.Background(), project, id)
		}))
		if exists {
			s.scheduler.Remove(previous.entryID)
		}
		s.scheduledJobs[id] = scheduledJob{entryID: entryID, expression: expression, projectID: project}
	}
	for id, previous := range s.scheduledJobs {
		if !active[id] {
			s.scheduler.Remove(previous.entryID)
			delete(s.scheduledJobs, id)
		}
	}
	return nil
}

func (s *Service) previewCron(c *gin.Context) {
	data, ok := body(c)
	if !ok {
		return
	}
	if _, ok := data["cronExp"].(string); !ok {
		fail(c, 400, "Cron 表达式必须为字符串")
		return
	}
	schedule, err := parseJobSchedule(str(data, "cronExp"))
	if err != nil {
		fail(c, 400, err.Error())
		return
	}
	location := s.scheduler.Location()
	next := schedule.Next(time.Now().In(location))
	var nextRun interface{}
	if !next.IsZero() {
		nextRun = next.In(location).Format(time.RFC3339)
	}
	c.JSON(200, Object{"nextRun": nextRun, "timezone": location.String()})
}
