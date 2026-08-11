import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { PageLoader } from './components/ui.jsx';
import AppLayout from './components/AppLayout.jsx';
import RequireRole from './components/RequireRole.jsx';

import Login from './pages/Login.jsx';
import StudentTests from './pages/student/StudentTests.jsx';
import StudentResults from './pages/student/StudentResults.jsx';
import ExamShell from './pages/exam/ExamShell.jsx';
import TeacherTests from './pages/teacher/TeacherTests.jsx';
import TestEditor from './pages/teacher/TestEditor.jsx';
import TestDetail from './pages/teacher/TestDetail.jsx';
import QuestionLibrary from './pages/teacher/QuestionLibrary.jsx';
import QuestionEditor from './pages/teacher/QuestionEditor.jsx';
import GatePaperBuilder from './pages/teacher/GatePaperBuilder.jsx';
import SubmissionViewer from './pages/teacher/SubmissionViewer.jsx';
import AdminUsers from './pages/admin/AdminUsers.jsx';

function RoleHome() {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'student' ? '/tests' : '/teacher'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* The exam runs outside the app chrome — fullscreen, no navigation. */}
      <Route
        path="/exam/:testId"
        element={
          <RequireRole roles={['student', 'teacher', 'admin']}>
            <ExamShell />
          </RequireRole>
        }
      />

      <Route
        element={
          <RequireRole>
            <AppLayout />
          </RequireRole>
        }
      >
        <Route path="/" element={<RoleHome />} />

        <Route path="/tests" element={<StudentTests />} />
        <Route path="/results" element={<StudentResults />} />

        <Route
          path="/teacher"
          element={
            <RequireRole roles={['teacher', 'admin']}>
              <TeacherTests />
            </RequireRole>
          }
        />
        <Route
          path="/teacher/tests/new"
          element={
            <RequireRole roles={['teacher', 'admin']}>
              <TestEditor />
            </RequireRole>
          }
        />
        <Route
          path="/teacher/tests/:testId/*"
          element={
            <RequireRole roles={['teacher', 'admin']}>
              <TestDetail />
            </RequireRole>
          }
        />
        <Route
          path="/teacher/gate"
          element={
            <RequireRole roles={['teacher', 'admin']}>
              <GatePaperBuilder />
            </RequireRole>
          }
        />
        <Route
          path="/teacher/gate/:testId"
          element={
            <RequireRole roles={['teacher', 'admin']}>
              <GatePaperBuilder />
            </RequireRole>
          }
        />
        <Route
          path="/teacher/questions"
          element={
            <RequireRole roles={['teacher', 'admin']}>
              <QuestionLibrary />
            </RequireRole>
          }
        />
        <Route
          path="/teacher/questions/new"
          element={
            <RequireRole roles={['teacher', 'admin']}>
              <QuestionEditor />
            </RequireRole>
          }
        />
        <Route
          path="/teacher/questions/:questionId"
          element={
            <RequireRole roles={['teacher', 'admin']}>
              <QuestionEditor />
            </RequireRole>
          }
        />
        <Route
          path="/teacher/submissions/:submissionId"
          element={
            <RequireRole roles={['teacher', 'admin']}>
              <SubmissionViewer />
            </RequireRole>
          }
        />

        <Route
          path="/admin/users"
          element={
            <RequireRole roles={['admin']}>
              <AdminUsers />
            </RequireRole>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
