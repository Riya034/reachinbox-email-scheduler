import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { AppShell } from "./components/layout/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { EmailListPage } from "./pages/EmailListPage";
import { EmailDetailPage } from "./pages/EmailDetailPage";
import { ComposePage } from "./pages/ComposePage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/scheduled" element={<EmailListPage variant="scheduled" />} />
        <Route path="/sent" element={<EmailListPage variant="sent" />} />
        <Route path="/compose" element={<ComposePage />} />
        <Route path="/email/:id" element={<EmailDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/scheduled" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
