-- User feedback storage table
create table if not exists user_feedback (
	id uuid primary key default gen_random_uuid(),
	user_id text,
	user_email text,
	user_name text,
	subject text not null,
	message text not null,
	category text not null default 'general',
	diagnostics jsonb,
	status text not null default 'new',
	created_at timestamptz not null default now()
);

create index if not exists idx_user_feedback_created_at on user_feedback (created_at desc);
create index if not exists idx_user_feedback_user_id on user_feedback (user_id);

