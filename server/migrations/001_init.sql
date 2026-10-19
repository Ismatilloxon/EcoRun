-- EcoRun initial schema. Geo: cube + earthdistance (indexed radius search via ll_to_earth).
create extension if not exists cube;
create extension if not exists earthdistance;
create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  phone text unique,
  name text,
  photo_url text,
  gender text check (gender in ('male','female','other')),
  birth_year int,
  age_range text,
  district text,
  level text check (level in ('beginner','intermediate','advanced')),
  pace_sec_per_km int,
  preferred_distances int[] not null default '{}',
  preferred_time text check (preferred_time in ('morning','day','evening')),
  language text not null default 'uz' check (language in ('uz','ru','en')),
  role text not null default 'runner'
    check (role in ('runner','club_organizer','partner','event_organizer','moderator','admin')),
  visibility text not null default 'all' check (visibility in ('all','followers','nobody')),
  hide_location boolean not null default true,
  notify_nearby boolean not null default true,
  notify_radius_km int not null default 5,
  last_lat double precision,
  last_lng double precision,
  strava_id text unique,
  strava_tokens jsonb,
  telegram_id bigint unique,
  telegram_username text,
  google_sub text unique,
  apple_sub text unique,
  totp_secret text,
  totp_enabled boolean not null default false,
  invite_code text unique not null default substr(md5(gen_random_uuid()::text), 1, 8),
  invited_by uuid references users(id) on delete set null,
  invite_rewarded boolean not null default false,
  onboarded boolean not null default false,
  blocked boolean not null default false,
  blocked_reason text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index users_district_idx on users (district);

create table user_days (
  user_id uuid not null references users(id) on delete cascade,
  day date not null,
  primary key (user_id, day)
);
create index user_days_day_idx on user_days (day);

create table otp_codes (
  id bigserial primary key,
  phone text not null,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index otp_phone_idx on otp_codes (phone, created_at desc);

create table refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  mfa boolean not null default false,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table telegram_tokens (
  token text primary key,
  purpose text not null check (purpose in ('login','link')),
  user_id uuid references users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','confirmed','used')),
  telegram_id bigint,
  created_at timestamptz not null default now()
);

create table follows (
  follower_id uuid not null references users(id) on delete cascade,
  followee_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on follows (followee_id);

create table blocks (
  blocker_id uuid not null references users(id) on delete cascade,
  blocked_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create table clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text,
  cover_url text,
  description text,
  district text,
  lat double precision,
  lng double precision,
  address text,
  schedule_text text,
  telegram_link text,
  instagram text,
  verified boolean not null default false,
  verification_requested_at timestamptz,
  owner_id uuid not null references users(id),
  hidden boolean not null default false,
  featured boolean not null default false,
  created_at timestamptz not null default now()
);

create table club_members (
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','co_organizer','member')),
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create index club_members_user_idx on club_members (user_id);

create table club_photos (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  url text not null,
  created_at timestamptz not null default now()
);

create table dirty_spots (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references users(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  photo_url text,
  description text,
  status text not null default 'reported'
    check (status in ('reported','approved','scheduled','cleaned','rejected')),
  reviewed_by uuid references users(id),
  review_reason text,
  created_at timestamptz not null default now(),
  cleaned_at timestamptz
);
create index dirty_spots_geo_idx on dirty_spots using gist (ll_to_earth(lat, lng));

create table runs (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references users(id),
  club_id uuid references clubs(id) on delete set null,
  series_id uuid,
  title text not null,
  description text,
  type text not null default 'casual' check (type in ('casual','training','plogging','race_prep')),
  start_at timestamptz not null,
  meeting_lat double precision not null,
  meeting_lng double precision not null,
  meeting_address text,
  district text,
  route jsonb,
  distance_km numeric(5,2),
  pace_groups text[] not null default '{}',
  level text check (level in ('beginner','intermediate','advanced','all')),
  capacity int,
  women_only boolean not null default false,
  requires_approval boolean not null default false,
  recurrence_rule text,
  cover_url text,
  plogging_supplies text,
  plogging_dropoff text,
  dirty_spot_id uuid references dirty_spots(id) on delete set null,
  checkin_code text not null default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  status text not null default 'scheduled' check (status in ('scheduled','cancelled','completed')),
  hidden boolean not null default false,
  featured boolean not null default false,
  organizer_rewarded boolean not null default false,
  created_at timestamptz not null default now()
);
create index runs_start_idx on runs (start_at);
create index runs_geo_idx on runs using gist (ll_to_earth(meeting_lat, meeting_lng));
create index runs_series_idx on runs (series_id);

create table participations (
  run_id uuid not null references runs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  status text not null default 'joined'
    check (status in ('pending','joined','waitlist','checked_in','no_show','left','rejected')),
  joined_at timestamptz not null default now(),
  check_in_at timestamptz,
  check_in_method text,
  rating smallint check (rating between 1 and 5),
  primary key (run_id, user_id)
);
create index participations_user_idx on participations (user_id);

create table run_reminders (
  run_id uuid not null references runs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  sent_at timestamptz not null default now(),
  primary key (run_id, user_id, kind)
);

create table messages (
  id bigserial primary key,
  run_id uuid not null references runs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  body text not null,
  is_announcement boolean not null default false,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index messages_run_idx on messages (run_id, id);

create table direct_messages (
  id bigserial primary key,
  sender_id uuid not null references users(id) on delete cascade,
  recipient_id uuid not null references users(id) on delete cascade,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index dm_pair_idx on direct_messages (least(sender_id, recipient_id), greatest(sender_id, recipient_id), id);

create table activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  run_id uuid references runs(id) on delete set null,
  started_at timestamptz not null,
  distance_m int not null,
  duration_s int not null,
  avg_pace_s int,
  track jsonb,
  splits jsonb,
  best_efforts jsonb,
  source text not null default 'app' check (source in ('app','strava','health')),
  external_id text,
  is_commute boolean not null default false,
  flagged boolean not null default false,
  flag_reason text,
  created_at timestamptz not null default now(),
  unique (user_id, source, external_id)
);
create index activities_user_idx on activities (user_id, started_at desc);
create index activities_started_idx on activities (started_at);

create table eco_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  run_id uuid references runs(id) on delete set null,
  activity_id uuid references activities(id) on delete set null,
  dirty_spot_id uuid references dirty_spots(id) on delete set null,
  type text not null default 'plogging',
  bags_small int not null default 0 check (bags_small >= 0 and bags_small <= 20),
  bags_large int not null default 0 check (bags_large >= 0 and bags_large <= 20),
  waste_types text[] not null default '{}',
  photo_before_url text,
  photo_after_url text,
  lat double precision,
  lng double precision,
  verification jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references users(id),
  review_reason text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index eco_actions_status_idx on eco_actions (status, created_at);

create table points_transactions (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  amount int not null,
  reason text not null,
  source_type text,
  source_id text,
  status text not null default 'confirmed' check (status in ('pending','confirmed','rejected')),
  note text,
  created_at timestamptz not null default now()
);
create unique index points_unique_source on points_transactions (user_id, reason, source_id) where source_id is not null;
create index points_user_idx on points_transactions (user_id, created_at desc);

create table badges (
  code text primary key,
  title jsonb not null,
  description jsonb not null,
  icon text not null default 'medal'
);
create table user_badges (
  user_id uuid not null references users(id) on delete cascade,
  badge_code text not null references badges(code),
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_code)
);

create table partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text,
  description text,
  contacts jsonb not null default '{}',
  branches jsonb not null default '[]',
  contract_status text not null default 'active' check (contract_status in ('lead','active','paused','ended')),
  created_at timestamptz not null default now()
);
create table partner_users (
  partner_id uuid not null references partners(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  primary key (partner_id, user_id)
);

create table challenges (
  id uuid primary key default gen_random_uuid(),
  title jsonb not null,
  description jsonb not null default '{}',
  metric text not null check (metric in ('km','group_runs','plogging_runs','eco_points','runs')),
  target numeric not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  sponsor_partner_id uuid references partners(id) on delete set null,
  reward_points int not null default 0,
  reward_text jsonb,
  badge_code text references badges(code),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table challenge_participants (
  challenge_id uuid not null references challenges(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (challenge_id, user_id)
);

create table rewards (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id) on delete cascade,
  title text not null,
  description text,
  terms text,
  photo_url text,
  category text not null default 'other' check (category in ('cafe','sport','gym','eco','other')),
  points_price int not null check (points_price > 0),
  stock int not null default 0 check (stock >= 0),
  valid_until date,
  branches text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table redemptions (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid not null references rewards(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  code text not null unique,
  status text not null default 'issued' check (status in ('issued','redeemed','expired','cancelled')),
  points_spent int not null,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references users(id),
  branch text,
  created_at timestamptz not null default now()
);
create index redemptions_reward_idx on redemptions (reward_id, status);

create table donation_projects (
  id uuid primary key default gen_random_uuid(),
  title jsonb not null,
  description jsonb not null default '{}',
  sponsor text,
  points_goal int not null,
  unit_label jsonb,
  points_per_unit int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references users(id),
  title text not null,
  description text,
  type text not null default 'race' check (type in ('race','eco_run','virtual')),
  start_at timestamptz not null,
  location text,
  lat double precision,
  lng double precision,
  distances jsonb not null default '[]',
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  cover_url text,
  status text not null default 'published' check (status in ('draft','published','cancelled','finished')),
  created_at timestamptz not null default now()
);
create table event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  distance_km numeric not null,
  amount int not null default 0,
  status text not null default 'confirmed' check (status in ('pending_payment','confirmed','cancelled','refunded')),
  ticket_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 10)),
  provider text,
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references users(id) on delete cascade,
  target_type text not null check (target_type in ('user','run','message','club','eco_action')),
  target_id text not null,
  reason text not null,
  details text,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolved_by uuid references users(id),
  resolution_note text,
  created_at timestamptz not null default now()
);

create table notifications (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  data jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, id desc);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  endpoint text not null unique,
  keys jsonb not null,
  created_at timestamptz not null default now()
);

create table push_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  segment jsonb not null default '{}',
  scheduled_at timestamptz,
  sent_at timestamptz,
  sent_count int,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table content (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('banner','faq','terms','privacy')),
  title jsonb not null default '{}',
  body jsonb not null default '{}',
  image_url text,
  link text,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table uploads (
  url text primary key,
  user_id uuid references users(id) on delete set null,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  actor_id uuid references users(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  data jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index audit_created_idx on audit_log (created_at desc);
