import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS, type Role } from '../lib/types';
import { Button } from './ui';

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

/** Role-specific navigation. Mirrors, but never replaces, the server-side permission checks. */
export function navItemsFor(role: Role): NavItem[] {
  const dashboard: NavItem = { to: '/', label: 'Dashboard', end: true };
  switch (role) {
    case 'FARMER':
      return [dashboard, { to: '/requests', label: 'My requests', end: true }, { to: '/requests/new', label: 'New request' }];
    case 'PURCHASE_MANAGER':
      return [
        dashboard,
        { to: '/requests', label: 'Procurement requests' },
        { to: '/inspections', label: 'Inspections' },
        { to: '/collections', label: 'Collections' },
        { to: '/schedule', label: 'Arrival schedule' },
        { to: '/shipments', label: 'Shipments' },
        { to: '/queue', label: 'Processing queue' },
        { to: '/exceptions', label: 'Exceptions' },
        { to: '/factory/slots', label: 'Slots' },
      ];
    case 'FIELD_OFFICER':
      return [dashboard, { to: '/inspections', label: 'My inspections' }, { to: '/collections', label: 'Collections to attend' }];
    case 'TRANSPORT_OFFICER':
      return [dashboard, { to: '/collections', label: 'My collections' }];
    case 'SECURITY_OFFICER':
      return [dashboard, { to: '/gate', label: 'Gate' }];
    case 'FACTORY_OPERATOR':
      return [dashboard, { to: '/shipments', label: 'Shipments' }, { to: '/queue', label: 'Processing queue' }];
    case 'ADMIN':
      return [
        dashboard,
        { to: '/requests', label: 'Procurement requests' },
        { to: '/inspections', label: 'Inspections' },
        { to: '/collections', label: 'Collections' },
        { to: '/schedule', label: 'Arrival schedule' },
        { to: '/shipments', label: 'Shipments' },
        { to: '/queue', label: 'Processing queue' },
        { to: '/exceptions', label: 'Exceptions' },
        { to: '/factory/slots', label: 'Slots & stations' },
        { to: '/vehicles', label: 'Vehicles' },
        { to: '/users', label: 'Users' },
      ];
    default:
      return [dashboard];
  }
}

export function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const items = navItemsFor(user.role);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `block rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-teal-300 ${
      isActive ? 'bg-teal-800 text-white' : 'text-teal-50 hover:bg-teal-800/70'
    }`;

  return (
    <div className="flex min-h-full flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="bg-teal-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-md p-2 hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-teal-300 md:hidden"
              aria-expanded={open}
              aria-controls="primary-nav"
              onClick={() => setOpen((v) => !v)}
            >
              <span className="sr-only">Toggle navigation</span>
              <span aria-hidden>☰</span>
            </button>
            <span className="text-base font-semibold tracking-tight">Prawn Factory</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="hidden text-right sm:block">
              <p className="font-medium leading-tight">{user.fullName}</p>
              <p className="text-xs text-teal-200">{ROLE_LABELS[user.role]}</p>
            </div>
            <Button variant="secondary" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </div>
        <nav id="primary-nav" aria-label="Primary" className={`${open ? 'block' : 'hidden'} border-t border-teal-800 md:block`}>
          <ul className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-2 md:flex-row">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end ?? false} className={linkClass} onClick={() => setOpen(false)}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-500">
        Demonstration system · amounts in INR (₹) · weights in kilograms
      </footer>
    </div>
  );
}
