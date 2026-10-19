import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from './store.tsx';
import { Icon } from './ui/Icon.tsx';
import { Loading } from './ui/ui.tsx';
import { flushPendingActivities } from './app/Record.tsx';
import { Welcome, Login, Onboarding } from './app/Onboarding.tsx';
import { Home } from './app/Home.tsx';
import { Runs } from './app/Runs.tsx';
import { RunDetail } from './app/RunDetail.tsx';
import { RunForm } from './app/RunForm.tsx';
import { Chat } from './app/Chat.tsx';
import { Record, ActivityDetail } from './app/Record.tsx';
import { EcoLog, Spots, EcoHistory, Donate } from './app/Eco.tsx';
import { Rewards, RewardDetail, MyCodes } from './app/Rewards.tsx';
import { Profile, PointsHistory, MyRuns, Leaderboard, Challenges, Notifications } from './app/Profile.tsx';
import { Settings, EditProfile, ContentPage } from './app/Settings.tsx';
import { UserProfile, Buddies, Messages, Thread } from './app/Social.tsx';
import { Clubs, ClubDetail, ClubForm } from './app/Clubs.tsx';
import { Events, EventDetail } from './app/Events.tsx';

const AdminApp = lazy(() => import('./admin/AdminApp.tsx'));
const PartnerApp = lazy(() => import('./partner/PartnerApp.tsx'));
const OrganizerApp = lazy(() => import('./organizer/OrganizerApp.tsx'));

function TabBar() {
  const { t } = useApp();
  const tabs = [
    { to: '/', icon: 'home', label: t('tab.home'), end: true },
    { to: '/runs', icon: 'map', label: t('tab.runs') },
    { to: '/record', icon: 'record', label: t('tab.record'), record: true },
    { to: '/rewards', icon: 'gift', label: t('tab.rewards') },
    { to: '/profile', icon: 'person', label: t('tab.profile') },
  ];
  return (
    <nav className="tabbar" aria-label="EcoRun">
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `${isActive && !tab.record ? 'active' : ''} ${tab.record ? 'record' : ''}`} aria-label={tab.label}>
          {tab.record ? (
            <span className="rec">
              <Icon name="play" size={22} fill />
            </span>
          ) : (
            <>
              <Icon name={tab.icon} size={24} />
              <span>{tab.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

const TAB_ROOTS = ['/', '/runs', '/rewards', '/profile'];

function MobileShell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  useEffect(() => {
    document.body.classList.add('mobile-shell');
    return () => document.body.classList.remove('mobile-shell');
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);
  const showTabs = TAB_ROOTS.includes(loc.pathname) || loc.pathname.startsWith('/leaderboard') || loc.pathname === '/challenges';
  return (
    <div className="app-frame">
      {children}
      {showTabs && <TabBar />}
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loadingMe } = useApp();
  const loc = useLocation();
  if (loadingMe) return <Loading />;
  if (!me) return <Navigate to="/welcome" replace state={{ from: loc.pathname }} />;
  if (!me.onboarded) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

function RequireRole({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { me, loadingMe } = useApp();
  if (loadingMe) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  if (!roles.includes(me.role)) return <Navigate to="/profile" replace />;
  return <>{children}</>;
}

export function App() {
  const { me, loadingMe } = useApp();
  useEffect(() => {
    if (me) flushPendingActivities();
    const on = () => me && flushPendingActivities();
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [me]);

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/admin/*" element={<RequireRole roles={['admin', 'moderator']}><AdminApp /></RequireRole>} />
        <Route path="/partner/*" element={<RequireRole roles={['partner', 'admin']}><PartnerApp /></RequireRole>} />
        <Route path="/organizer/*" element={<RequireAuth><OrganizerApp /></RequireAuth>} />
        <Route
          path="*"
          element={
            <MobileShell>
              <Routes>
                <Route path="/welcome" element={<Welcome />} />
                <Route path="/login" element={<Login />} />
                <Route path="/onboarding" element={me ? <Onboarding /> : loadingMe ? <Loading /> : <Navigate to="/welcome" replace />} />
                <Route path="/" element={!loadingMe && !me ? <Navigate to="/welcome" replace /> : me && !me.onboarded ? <Navigate to="/onboarding" replace /> : <Home />} />
                <Route path="/runs" element={<Runs />} />
                <Route path="/runs/new" element={<RequireAuth><RunForm /></RequireAuth>} />
                <Route path="/runs/:id" element={<RunDetail />} />
                <Route path="/runs/:id/edit" element={<RequireAuth><RunForm /></RequireAuth>} />
                <Route path="/runs/:id/chat" element={<RequireAuth><Chat /></RequireAuth>} />
                <Route path="/record" element={<RequireAuth><Record /></RequireAuth>} />
                <Route path="/activities/:id" element={<ActivityDetail />} />
                <Route path="/eco/log" element={<RequireAuth><EcoLog /></RequireAuth>} />
                <Route path="/eco/spots" element={<Spots />} />
                <Route path="/eco/history" element={<RequireAuth><EcoHistory /></RequireAuth>} />
                <Route path="/eco/donate" element={<RequireAuth><Donate /></RequireAuth>} />
                <Route path="/rewards" element={<Rewards />} />
                <Route path="/rewards/codes" element={<RequireAuth><MyCodes /></RequireAuth>} />
                <Route path="/rewards/:id" element={<RewardDetail />} />
                <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
                <Route path="/profile/edit" element={<RequireAuth><EditProfile /></RequireAuth>} />
                <Route path="/profile/points" element={<RequireAuth><PointsHistory /></RequireAuth>} />
                <Route path="/profile/runs" element={<RequireAuth><MyRuns /></RequireAuth>} />
                <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
                <Route path="/page/:kind" element={<ContentPage />} />
                <Route path="/leaderboard" element={<Leaderboard />} />
                <Route path="/challenges" element={<Challenges />} />
                <Route path="/notifications" element={<RequireAuth><Notifications /></RequireAuth>} />
                <Route path="/users/:id" element={<UserProfile />} />
                <Route path="/buddies" element={<RequireAuth><Buddies /></RequireAuth>} />
                <Route path="/messages" element={<RequireAuth><Messages /></RequireAuth>} />
                <Route path="/messages/:id" element={<RequireAuth><Thread /></RequireAuth>} />
                <Route path="/clubs" element={<Clubs />} />
                <Route path="/clubs/new" element={<RequireAuth><ClubForm /></RequireAuth>} />
                <Route path="/clubs/:id" element={<ClubDetail />} />
                <Route path="/events" element={<Events />} />
                <Route path="/events/:id" element={<EventDetail />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </MobileShell>
          }
        />
      </Routes>
    </Suspense>
  );
}
