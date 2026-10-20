package crond

import (
	"strings"
	"testing"
	"time"

	"github.com/robfig/cron/v3"
)

func TestSchedulerUpdatesOnlyChangedEntries(t *testing.T) {
	s, c, base := loginProject(t)
	first := c.call("POST", base+"/jobs", Object{"name": "first", "type": "shell", "cronExp": "@every 1h", "content": "echo first"}, 200).(map[string]interface{})
	second := c.call("POST", base+"/jobs", Object{"name": "second", "type": "shell", "cronExp": "@every 2h", "content": "echo second"}, 200).(map[string]interface{})
	firstID, secondID := str(first, "id"), str(second, "id")
	if err := s.Start(); err != nil {
		t.Fatal(err)
	}
	firstEntry := s.scheduler.Entry(s.scheduledJobs[firstID].entryID)
	secondEntry := s.scheduler.Entry(s.scheduledJobs[secondID].entryID)
	assertPreserved := func(id string, original cron.Entry) {
		t.Helper()
		entry := s.scheduler.Entry(s.scheduledJobs[id].entryID)
		if entry.ID != original.ID || !entry.Next.Equal(original.Next) {
			t.Fatalf("unchanged task %s was reset: %+v", id, entry)
		}
	}
	c.call("PATCH", base+"/jobs/"+firstID, Object{"name": "renamed", "content": "echo new content"}, 200)
	assertPreserved(firstID, firstEntry)
	assertPreserved(secondID, secondEntry)
	third := c.call("POST", base+"/jobs", Object{"name": "third", "type": "shell", "cronExp": "@daily"}, 200).(map[string]interface{})
	c.call("DELETE", base+"/jobs/"+str(third, "id"), nil, 200)
	assertPreserved(firstID, firstEntry)
	assertPreserved(secondID, secondEntry)
	c.call("PATCH", base+"/jobs/"+firstID, Object{"cronExp": "@every 3h"}, 200)
	if s.scheduledJobs[firstID].entryID == firstEntry.ID {
		t.Fatal("changed expression did not update the schedule")
	}
	assertPreserved(secondID, secondEntry)
	c.call("PATCH", base+"/jobs/"+firstID, Object{"status": "inactive"}, 200)
	if _, exists := s.scheduledJobs[firstID]; exists {
		t.Fatal("disabled task still scheduled")
	}
	c.call("PATCH", base+"/jobs/"+firstID, Object{"status": "active"}, 200)
	if !s.scheduler.Entry(s.scheduledJobs[firstID].entryID).Valid() {
		t.Fatal("re-enabled task was not scheduled")
	}
	assertPreserved(secondID, secondEntry)
	c.call("DELETE", base, nil, 200)
	if len(s.scheduledJobs) != 0 || len(s.scheduler.Entries()) != 0 {
		t.Fatal("deleted project still has scheduled tasks")
	}
}

func TestSchedulerIntervalRunsDuringUnrelatedEdits(t *testing.T) {
	s, c, base := loginProject(t)
	project := strings.TrimPrefix(base, "/api/projects/")
	job := c.call("POST", base+"/jobs", Object{"name": "interval target", "type": "shell", "content": "echo interval-fired", "cronExp": "@every 2s"}, 200).(map[string]interface{})
	other := c.call("POST", base+"/jobs", Object{"name": "unrelated", "type": "shell", "cronExp": "@daily", "status": "inactive"}, 200).(map[string]interface{})
	if err := s.Start(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3200 * time.Millisecond)
	for time.Now().Before(deadline) {
		c.call("PATCH", base+"/jobs/"+str(other, "id"), Object{"name": "unrelated"}, 200)
		time.Sleep(200 * time.Millisecond)
	}
	logs, err := s.list(project, "logs", str(job, "id"))
	if err != nil || len(logs) == 0 {
		t.Fatalf("interval task never executed during unrelated edits: %v", err)
	}
	if str(logs[0], "status") != "success" || !strings.Contains(str(logs[0], "output"), "interval-fired") {
		t.Fatal(logs)
	}
}

func TestCronPreviewMatchesJobValidationAndTimezone(t *testing.T) {
	_, c := setup(t)
	c.call("POST", "/api/cron/preview", Object{"cronExp": "@daily"}, 401)
	c.call("POST", "/api/auth/test", nil, 200)
	for _, tc := range []struct {
		expression string
		status     int
	}{
		{"0 9 * * *", 200},
		{"@every 5m", 200},
		{"@daily", 200},
		{"CRON_TZ=UTC 0 9 * * *", 200},
		{"", 200},
		{"0 0 9 * * *", 400},
		{"invalid", 400},
	} {
		t.Run(tc.expression, func(t *testing.T) {
			data := Object{"name": "preview", "type": "shell", "cronExp": tc.expression}
			validation := validateJob(data)
			if (validation == nil) != (tc.status == 200) {
				t.Fatalf("unexpected job validation: %v", validation)
			}
			response := c.call("POST", "/api/cron/preview", Object{"cronExp": tc.expression}, tc.status).(map[string]interface{})
			if tc.status != 200 {
				if response["error"] != validation.Error() {
					t.Fatalf("preview and save disagree: %+v vs %v", response, validation)
				}
				return
			}
			if response["timezone"] != "Asia/Shanghai" {
				t.Fatal(response)
			}
			next, err := time.Parse(time.RFC3339, str(response, "nextRun"))
			if err != nil || !next.After(time.Now().Add(-time.Second)) {
				t.Fatalf("invalid preview time: %+v (%v)", response, err)
			}
			if _, offset := next.Zone(); offset != 8*60*60 {
				t.Fatal("preview is not expressed in Shanghai time", response)
			}
			if tc.expression == "0 9 * * *" && next.Hour() != 9 {
				t.Fatal("daily 9am is not Shanghai 9am", response)
			}
			if tc.expression == "CRON_TZ=UTC 0 9 * * *" && next.Hour() != 17 {
				t.Fatal("explicit cron timezone was ignored", response)
			}
		})
	}
	c.call("POST", "/api/cron/preview", Object{"cronExp": 9}, 400)
	response := c.call("POST", "/api/cron/preview", Object{"cronExp": "0 0 31 2 *"}, 200).(map[string]interface{})
	if response["nextRun"] != nil {
		t.Fatal("impossible date has a next run", response)
	}
}
