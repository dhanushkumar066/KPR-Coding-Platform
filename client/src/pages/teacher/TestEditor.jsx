import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { PageHeader } from '../../components/ui.jsx';
import TestForm, { emptyTest, toPayload } from './TestForm.jsx';

export default function TestEditor() {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState(emptyTest);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const { test } = await api.post('/tests', toPayload(form));
      toast.success('Test created — now add the students who may sit it');
      navigate(`/teacher/tests/${test._id || test.id}/allowlist`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title="New test"
        subtitle="You can change any of this later, up until students start."
        back={{ to: '/teacher', label: 'Tests' }}
      />
      <div className="max-w-3xl">
        <TestForm
          value={form}
          onChange={setForm}
          onSubmit={submit}
          submitting={saving}
          submitLabel="Create test"
          footer={
            <button type="button" className="btn btn-ghost" onClick={() => navigate('/teacher')}>
              Cancel
            </button>
          }
        />
      </div>
    </>
  );
}
