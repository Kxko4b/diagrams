-- Exam prep ("Learn" card). Applied to the live project on 2026-10-24; kept here as documentation.
-- No secrets in this file: the cron jobs below were created from the existing briefing job's command (it holds the cron secret).

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  exam_date date not null,
  round smallint,                       -- 1 = first test, 2 = second test
  topics text not null default '',      -- the AI only quizzes what is written here
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject, exam_date)
);

create table public.exam_questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  kind text not null check (kind in ('cover','match','choice')),
  payload jsonb not null,
  right_count integer not null default 0,
  wrong_count integer not null default 0,
  last_seen timestamptz,
  created_at timestamptz not null default now()
);

-- Both tables: row-level security on, owner only (same rule as manual_homework).

-- Edge functions:
--   exam-quiz  (verify_jwt true)  owner calls it from the admin page; asks the AI for questions from the topic notes.
--   exam-ping  (verify_jwt false) cron-secret protected; pushes a reminder while an exam is within 7 days.

-- Cron (UTC; 17:00 and 21:00 Berlin in winter time. Move by one hour when summer time starts, end of March 2027):
--   exam-ping-afternoon  0 16 * * *   .../functions/v1/exam-ping?slot=afternoon
--   exam-ping-evening    0 20 * * *   .../functions/v1/exam-ping?slot=evening
--
-- Briefing jobs after the 2026-10-25 clock change (winter time): briefing-early 0 5, briefing-full 0 6, untis-watch */10 5-6, all Mon-Fri UTC.

-- Quiz voice (Cycling Quiz in the Android app), added 2026-10-28:
--   public.is_owner()  boolean, true only for the owner's login (same email rule as the other owner-only policies).
--   quiz-voice edge function (verify_jwt true): owner only; turns text into lively AI speech (WAV).
--     Uses OPENAI_TTS_KEY (real OpenAI key) if set, otherwise OpenRouter openai/gpt-audio-mini with the OpenRouter key
--     (OpenRouter needs at least $0.50 credit for audio). Any failure -> 503 and the app uses the phone's own voice.
