import { Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { Layout } from './components/Layout';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { CollectionDetailPage, CollectionsPage } from './pages/CollectionPages';
import { InspectionDetailPage, InspectionsPage } from './pages/InspectionPages';
import { DashboardPage } from './pages/DashboardPage';
import { ExceptionDetailPage, ExceptionsPage } from './pages/ExceptionPages';
import { FactorySetupPage } from './pages/FactorySetupPage';
import { GatePage } from './pages/GatePage';
import { ForbiddenPage, NotFoundPage } from './pages/MiscPages';
import { NewRequestPage } from './pages/NewRequestPage';
import { QueuePage } from './pages/QueuePage';
import { RequestDetailPage } from './pages/RequestDetailPage';
import { RequestsPage } from './pages/RequestsPage';
import { BookingDetailPage, SchedulePage } from './pages/SchedulePages';
import { ShipmentDetailPage, ShipmentsPage } from './pages/ShipmentPages';
import { UsersPage } from './pages/UsersPage';
import { VehiclesPage } from './pages/VehiclesPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="forbidden" element={<ForbiddenPage />} />
          <Route element={<RequireAuth roles={['FARMER', 'PURCHASE_MANAGER', 'ADMIN']} />}>
            <Route path="requests" element={<RequestsPage />} />
            <Route path="requests/:id" element={<RequestDetailPage />} />
          </Route>
          <Route element={<RequireAuth roles={['FARMER']} />}>
            <Route path="requests/new" element={<NewRequestPage />} />
          </Route>
          <Route element={<RequireAuth roles={['FIELD_OFFICER', 'PURCHASE_MANAGER', 'ADMIN']} />}>
            <Route path="inspections" element={<InspectionsPage />} />
            <Route path="inspections/:id" element={<InspectionDetailPage />} />
          </Route>
          <Route element={<RequireAuth roles={['TRANSPORT_OFFICER', 'FIELD_OFFICER', 'PURCHASE_MANAGER', 'ADMIN']} />}>
            <Route path="collections" element={<CollectionsPage />} />
            <Route path="collections/:id" element={<CollectionDetailPage />} />
          </Route>
          <Route element={<RequireAuth roles={['PURCHASE_MANAGER', 'ADMIN']} />}>
            <Route path="schedule" element={<SchedulePage />} />
            <Route path="schedule/:id" element={<BookingDetailPage />} />
            <Route path="exceptions" element={<ExceptionsPage />} />
            <Route path="exceptions/:id" element={<ExceptionDetailPage />} />
            <Route path="factory/slots" element={<FactorySetupPage />} />
          </Route>
          <Route element={<RequireAuth roles={['SECURITY_OFFICER']} />}>
            <Route path="gate" element={<GatePage />} />
          </Route>
          <Route element={<RequireAuth roles={['FACTORY_OPERATOR', 'PURCHASE_MANAGER', 'ADMIN']} />}>
            <Route path="shipments" element={<ShipmentsPage />} />
            <Route path="shipments/:id" element={<ShipmentDetailPage />} />
            <Route path="queue" element={<QueuePage />} />
          </Route>
          <Route element={<RequireAuth roles={['ADMIN']} />}>
            <Route path="vehicles" element={<VehiclesPage />} />
            <Route path="users" element={<UsersPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
