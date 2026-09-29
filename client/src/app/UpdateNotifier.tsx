import { useEffect, useRef } from 'react';
import { useToast } from '../shared/ui';
import { hasPromptedUpdate, showUpdateReadyToast } from '../shared/updateToast';

const updatePollIntervalMs = 30 * 60 * 1000;

interface UpdateNotifierProps {
  noticeEnabled: boolean;
}

// 在线公告和插件更新通知已停用；这里只保留客户端版本更新检查。
function UpdateNotifier({ noticeEnabled: _noticeEnabled }: UpdateNotifierProps) {
  const { showToast } = useToast();
  const updateCheckingRef = useRef(false);

  useEffect(() => {
    let disposed = false;

    const checkUpdate = async () => {
      if (updateCheckingRef.current) return;
      updateCheckingRef.current = true;

      try {
        const result = await window.yibiao?.checkUpdate();
        if (!result?.enabled || disposed || !result.updateAvailable || !result.downloaded || !result.version) return;
        if (hasPromptedUpdate(result.version)) return;
        showUpdateReadyToast(showToast, result.version);
      } catch {
        // 自动检查失败不打扰用户，手动检查入口会展示错误。
      } finally {
        updateCheckingRef.current = false;
      }
    };

    void checkUpdate();
    const timer = window.setInterval(() => void checkUpdate(), updatePollIntervalMs);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [showToast]);

  return null;
}

export default UpdateNotifier;
