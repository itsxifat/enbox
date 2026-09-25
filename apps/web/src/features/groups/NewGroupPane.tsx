/** /new/group — create a group, then open it. */
import { useNavigate } from 'react-router';
import { GroupCreateFlow } from './GroupCreateFlow';

export function NewGroupPane() {
  const navigate = useNavigate();
  return (
    <GroupCreateFlow
      onCancel={() => void navigate('/new')}
      onCreated={(chat) => void navigate(`/chats/${chat.id}`, { replace: true })}
    />
  );
}
