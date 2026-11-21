import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Capacitor } from '@capacitor/core'
import { App, type AppInfo } from '@capacitor/app'
import {
  IconChevronRightOutline14,
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconFollowsystemOutline16,
  IconInfoOutline16,
  IconLightOutline16,
  IconLinkOutline16,
  IconRightUpOutline14,
  IconSettingsOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  importHistory,
} from '../../services/chat/backup.js'
import { useIsMobile } from '../../app/viewport.js'
import { useChatStore } from '../../services/chat/store.js'
import {
  addPrompt,
  applyPrompt,
  DEFAULT_PROMPT_ID,
  removePrompt,
  updatePrompt,
  usePrompts,
} from '../../services/prompts.js'
import { regionCodes, getRegionName, provinces } from '../../services/location.js'
import { exportLogs } from '../../services/diagnostics/log.js'
import { downloadArchive, DownloadError } from '../../services/chat/history/importFromUrl.js'
import {
  formatBytes,
  resetImportProgress,
  setImportProgress,
  useImportProgress,
} from '../../services/chat/importProgress.js'
import {
  isChineseBrowser,
  setApiBaseUrl,
  setApiModel,
  setFontScale,
  setFontWeight,
  setLocale,
  setLocation,
  setThemePreference,
  setTtsVoice,
  useSettings,
  type ThemePreference,
} from '../../services/settings.js'
import {
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  FONT_SCALE_STEP,
  FONT_WEIGHT_MAX,
  FONT_WEIGHT_MIN,
  FONT_WEIGHT_STEP,
  resolveFontScale,
} from '../../app/fontScale.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import styles from './Settings.module.css'

/**
 * 设置弹窗：分「通用设置」（主题、语言、朗读音色、位置）与「数据管理」（API Key、导入、导出、删除）。
 * 桌面端为居中弹窗、左侧导航；移动端为底部弹层、导航横排在内容上方
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  return open ? <SettingsContent /> : null
}

/** 四个分组的标题与图标：桌面侧边导航和移动端首页列表共用 */
const sectionItems: Record<SettingsSection, { label: TranslationKey; icon: ReactNode }> = {
  general: {
    label: 'settingDialogAsideGeneralOptionLabel',
    icon: <IconSettingsOutline16 />,
  },
  api: {
    label: 'settingDialogAsideApiOptionLabel',
    icon: <IconLinkOutline16 />,
  },
  prompt: {
    label: 'settingDialogAsidePromptOptionLabel',
    icon: <IconEditOutline16 />,
  },
  data: { label: 'settingDialogAsideDataOptionLabel', icon: <IconDataOutline16 /> },
  about: { label: 'settingsGroupAbout', icon: <IconInfoOutline16 /> },
}

const sections = (['general', 'api', 'prompt', 'data', 'about'] as const).map((value) => ({
  value,
  ...sectionItems[value],
}))

const sectionLabels: Record<SettingsSection, TranslationKey> = {
  general: 'settingDialogAsideGeneralOptionLabel',
  api: 'settingDialogAsideApiOptionLabel',
  prompt: 'settingDialogAsidePromptOptionLabel',
  data: 'settingDialogAsideDataOptionLabel',
  about: 'settingsGroupAbout',
}

/** 移动端设置首页：像原生 App 一样按「应用 / 数据 / 关于」分组的白色卡片列表 */
const SettingsMenu = ({ onSelect }: { onSelect: (section: SettingsSection) => void }) => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const apiBaseUrl = useSettings((state) => state.apiBaseUrl)
  const [version, setVersion] = useState('')
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return
    }
    void App.getInfo().then((info) => setVersion(info.version))
  }, [])
  const themeLabel = t(
    themePreference === 'light'
      ? 'avatarMenuSettingsDialogThemeSelectLightOption'
      : themePreference === 'dark'
        ? 'avatarMenuSettingsDialogThemeSelectDarkOption'
        : 'avatarMenuSettingsDialogThemeSelectSystemOption'
  )
  const row = (value: SettingsSection, text?: string) => (
    <button key={value} type="button" className={styles.menuRow} onClick={() => onSelect(value)}>
      <span className={styles.menuIcon}>{sectionItems[value].icon}</span>
      <span className={styles.menuLabel}>{t(sectionItems[value].label)}</span>
      {text ? <span className={styles.menuValue}>{text}</span> : null}
      <IconChevronRightOutline14 />
    </button>
  )
  return (
    <div className={styles.menu}>
      <div className={styles.menuGroup}>{t('settingsGroupApp')}</div>
      <div className={styles.menuCard}>
        {row('general', themeLabel)}
        {row('prompt')}
      </div>
      <div className={styles.menuGroup}>{t('settingDialogAsideApiOptionLabel')}</div>
      <div className={styles.menuCard}>
        {row('api', apiBaseUrl ?? undefined)}
      </div>
      <div className={styles.menuGroup}>{t('settingsGroupData')}</div>
      <div className={styles.menuCard}>{row('data')}</div>
      <div className={styles.menuGroup}>{t('settingsGroupAbout')}</div>
      <div className={styles.menuCard}>{row('about', version || undefined)}</div>
    </div>
  )
}

const SettingsContent = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 打开时按调用方指定的分组选中，之后在弹窗内切换
  const [section, setSection] = useState(() => useSettingsDialog.getState().section)
  // 移动端沿用原生 App 的层级：先看分组列表，点进去才是具体设置页
  const [mobilePage, setMobilePage] = useState<'menu' | SettingsSection>(() =>
    useSettingsDialog.getState().section === 'general'
      ? 'menu'
      : useSettingsDialog.getState().section
  )
  // 切换分组不丢失正在输入的 API Key 与导入状态
  const apiKeyEditor = useApiKeyEditor()
  const historyImport = useHistoryImport()
  const linkImport = useLinkImport(historyImport.select)
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy = historyImport.busy || historyDelete.busy || replacingHistory
  // 桌面端始终是「导航 + 内容」两栏，只有移动端会进入二级页面
  const subPage = isMobile && mobilePage !== 'menu' ? mobilePage : null
  return (
    <>
      <Modal
        title={subPage === null ? t('settings') : t(sectionLabels[subPage])}
        leading={
          subPage === null ? undefined : (
            <IconButton
              className={styles.back}
              tone="primary"
              icon={<IconChevronRightOutline14 />}
              aria-label={t('back')}
              onClick={() => setMobilePage('menu')}
            />
          )
        }
        closable={subPage === null}
        centerTitle={isMobile}
        className={styles.dialog}
        mainClassName={styles.dialogMain}
        // 系统返回键在二级页先退回设置首页，首页再按才收起整个设置
        onBack={
          subPage === null
            ? undefined
            : () => {
                setMobilePage('menu')
                return true
              }
        }
        onClose={() => {
          if (!historyDelete.busy) {
            closeSettings()
          }
        }}
      >
        {isMobile && mobilePage === 'menu' ? (
          <SettingsMenu
            onSelect={(next) => {
              setSection(next)
              setMobilePage(next)
            }}
          />
        ) : (
          <>
            {isMobile ? null : (
              <div role="tablist" className={styles.navigation}>
                {sections.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="tab"
                    aria-selected={section === item.value}
                    className={clsx(styles.navItem, section === item.value && styles.navItemActive)}
                    onClick={() => setSection(item.value)}
                  >
                    {item.icon}
                    {t(item.label)}
                  </button>
                ))}
              </div>
            )}
            <div role="tabpanel" className={clsx(styles.content, isMobile && styles.mobileContent)}>
              {section === 'general' ? (
                <>
                  <FontScaleSetting />
                  <ThemeSetting />
                  <LocaleSetting />
                  <TtsVoiceSetting />
                  <LocationSetting />
                </>
              ) : section === 'api' ? (
                <>
                  <ApiSettings editor={apiKeyEditor} />
                  {isMobile ? <ApiKeyConfirm editor={apiKeyEditor} /> : null}
                </>
              ) : section === 'prompt' ? (
                <PromptSetting />
              ) : section === 'about' ? (
                <AboutSetting />
              ) : (
                <>
                  <ImportHistory
                    historyImport={historyImport}
                    linkImport={linkImport}
                    disabled={historyBusy}
                  />
                  <ExportHistory disabled={historyBusy} />
                  <ExportLogs />
                  <SettingCell
                    label={t('deleteAllSessions')}
                    status={null}
                    action={
                      <Button
                        variant="dangerOutlined"
                        size="m"
                        className={styles.cellButton}
                        disabled={historyBusy}
                        onClick={historyDelete.open}
                      >
                        {t('delete')}
                      </Button>
                    }
                  />
                </>
              )}
            </div>
          </>
        )}
      </Modal>
      {historyImport.file ? <ImportConfirm historyImport={historyImport} /> : null}
      {linkImport.open ? <LinkImportModal linkImport={linkImport} /> : null}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
    </>
  )
}

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

const LocationSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const province =
    location?.region === 'CN'
      ? provinces.find((item) => item.code === location.province)
      : undefined

  return (
    <SettingCell
      label={t('settingsLocation')}
      status={null}
      className={styles.locationCell}
      action={
        <div className={styles.locationSelectors}>
          {isChineseBrowser() ? (
            <>
              <Select
                ariaLabel={t('settingsLocationProvince')}
                className={styles.provinceSelect}
                value={province?.code ?? ''}
                placeholder={t('settingsLocationProvince')}
                options={provinces.map((item) => ({ value: item.code, label: item.name }))}
                onChange={(value) => {
                  if (value !== province?.code) {
                    setLocation({ region: 'CN', province: value })
                  }
                }}
              />
              <Select
                ariaLabel={t('settingsLocationCity')}
                className={styles.citySelect}
                value={province ? (location?.city ?? '') : ''}
                disabled={!province?.cities.length}
                placeholder={t('settingsLocationCity')}
                options={
                  province?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []
                }
                onChange={(value) => {
                  if (province) {
                    setLocation({ region: 'CN', province: province.code, city: value })
                  }
                }}
              />
            </>
          ) : (
            <Select
              ariaLabel={t('settingsLocationRegion')}
              className={styles.regionSelect}
              value={location?.region ?? ''}
              placeholder={t('settingsLocationRegion')}
              options={regionCodes
                .map((code) => ({ value: code, label: getRegionName(code, locale) }))
                .sort((a, b) => a.label.localeCompare(b.label, locale))}
              onChange={(value) => setLocation({ region: value })}
            />
          )}
        </div>
      }
    />
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

/** 朗读音色：stella（海星，女声）/ tide（暗潮，男声） */
const TtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  return (
    <SettingCell
      label={t('settingsTtsVoice')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsVoice')}
          value={ttsVoice}
          options={[
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onChange={setTtsVoice}
        />
      }
    />
  )
}

/** 提示词管理：默认提示词不可删除但可不使用；其余可增删、改标题与内容、点击应用 */
const PromptSetting = () => {
  const t = useTranslate()
  const prompts = usePrompts((state) => state.prompts)
  const activeId = usePrompts((state) => state.activeId)
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <div className={styles.promptSection}>
      <div className={styles.promptDescription}>{t('promptManageDescription')}</div>
      <div className={styles.promptList}>
        {prompts.map((prompt) => {
          const applied = activeId === prompt.id
          const isDefault = prompt.id === DEFAULT_PROMPT_ID
          return (
            <div key={prompt.id} className={styles.promptItem}>
              <div className={styles.promptItemTop}>
                {editing === prompt.id ? (
                  <input
                    className={styles.promptTitleInput}
                    value={prompt.title}
                    aria-label={t('promptTitleLabel')}
                    onChange={(event) => updatePrompt(prompt.id, { title: event.target.value })}
                    onBlur={() => setEditing(null)}
                    autoFocus
                  />
                ) : (
                  <button
                    type="button"
                    className={styles.promptTitle}
                    onClick={() => setEditing(prompt.id)}
                    title={t('promptEditTitle')}
                  >
                    {prompt.title || t('promptUntitled')}
                    {isDefault ? (
                      <span className={styles.promptDefaultTag}>{t('promptDefaultTag')}</span>
                    ) : null}
                  </button>
                )}
                <div className={styles.promptItemActions}>
                  <Button
                    variant={applied ? 'primary' : 'outlined'}
                    size="s"
                    className={styles.cellButton}
                    disabled={applied}
                    onClick={() => applyPrompt(prompt.id)}
                  >
                    {applied ? t('promptApplied') : t('promptApply')}
                  </Button>
                  {!isDefault ? (
                    <Button
                      variant="dangerOutlined"
                      size="s"
                      className={styles.cellButton}
                      onClick={() => removePrompt(prompt.id)}
                    >
                      {t('delete')}
                    </Button>
                  ) : null}
                </div>
              </div>
              <textarea
                className={styles.promptContent}
                value={prompt.content}
                aria-label={t('promptContentLabel')}
                placeholder={t('promptContentPlaceholder')}
                rows={3}
                onChange={(event) => updatePrompt(prompt.id, { content: event.target.value })}
              />
            </div>
          )
        })}
      </div>
      <div className={styles.promptFooter}>
        <Button variant="outlined" size="m" onClick={addPrompt}>
          {t('promptAdd')}
        </Button>
        <Button
          variant={activeId === null ? 'primary' : 'outlined'}
          size="m"
          disabled={activeId === null}
          onClick={() => applyPrompt(null)}
        >
          {t('promptNone')}
        </Button>
      </div>
      <div className={styles.promptNote}>{t('promptApplyNote')}</div>
    </div>
  )
}

/** 覆盖导入的二次确认，叠在设置弹窗上 */
const ImportConfirm = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  const busy = historyImport.busy
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      className={styles.importConfirm}
      onClose={busy ? () => {} : historyImport.cancel}
      footer={
        <>
          <Button
            variant="outlined"
            size="m"
            autoFocus
            disabled={busy}
            onClick={historyImport.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="dangerOutlined"
            size="m"
            disabled={busy}
            onClick={() => void historyImport.confirm()}
          >
            {t(busy ? 'historyImporting' : 'historyImportConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>{t('historyImportConfirmDescription')}</div>
      {busy ? <ImportProgressPanel /> : null}
    </Modal>
  )
}

/** 下载 / 校验 / 写入三阶段的进度条，读全局 store */
const ImportProgressPanel = () => {
  const t = useTranslate()
  const { stage, processed, total, downloadPercent, downloadedBytes, totalBytes, sessions } =
    useImportProgress()

  const percent =
    stage === 'download'
      ? downloadPercent
      : stage === 'verify'
        ? null
        : total > 0
          ? Math.round((processed / total) * 100)
          : null

  const label =
    stage === 'download'
      ? downloadPercent === null
        ? t('importStageDownload')
        : `${t('importStageDownload')} ${downloadPercent}%`
      : stage === 'verify'
        ? t('importStageVerify')
        : total > 0
          ? t('importStageImport', { processed, total })
          : t('importStageImportUnknown', { sessions })

  const sub =
    stage === 'download' && totalBytes > 0
      ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`
      : stage === 'import' && sessions > 0 && total > 0
        ? t('importStageSessions', { sessions })
        : ''

  return (
    <div className={styles.importProgress}>
      <div
        className={clsx(
          styles.importProgressTrack,
          percent === null && styles.importProgressIndeterminate
        )}
        role="progressbar"
        aria-valuenow={percent ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={styles.importProgressFill}
          style={percent === null ? undefined : { width: `${Math.max(2, percent)}%` }}
        />
      </div>
      <div className={styles.importProgressLabel}>{label}</div>
      {sub ? <div className={styles.importProgressSub}>{sub}</div> : null}
    </div>
  )
}

/** 从官方下载链接导入：粘贴链接 → 下载 → 交给覆盖确认流程 */
const LinkImportModal = ({ linkImport }: { linkImport: ReturnType<typeof useLinkImport> }) => {
  const t = useTranslate()
  const stage = useImportProgress((state) => state.stage)
  const downloading = stage === 'download' || stage === 'verify'
  return (
    <Modal
      title={t('historyImportLinkTitle')}
      className={styles.linkImport}
      onClose={downloading ? () => {} : linkImport.closeDialog}
      footer={
        <>
          <Button
            variant="outlined"
            size="m"
            disabled={downloading}
            onClick={linkImport.closeDialog}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            size="m"
            disabled={downloading || !linkImport.url.trim()}
            onClick={() => void linkImport.start()}
          >
            {t('historyImportLinkAction')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>{t('historyImportLinkHint')}</div>
      <input
        className={styles.linkInput}
        value={linkImport.url}
        onChange={(event) => linkImport.setUrl(event.target.value)}
        placeholder={t('historyImportLinkPlaceholder')}
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoFocus
      />
      {downloading ? <ImportProgressPanel /> : null}
      {linkImport.error ? (
        <div className={styles.linkError}>{t(linkImport.error.key, linkImport.error.params)}</div>
      ) : null}
    </Modal>
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

/**
 * API 设置：接口地址、API Key、自定义模型名。
 * 接口需兼容 Anthropic 协议（/v1/messages）；留空即用官方接口与界面选择的模型。
 */
const ApiSettings = ({ editor }: { editor: ReturnType<typeof useApiKeyEditor> }) => {
  const t = useTranslate()
  const apiBaseUrl = useSettings((state) => state.apiBaseUrl)
  const apiModel = useSettings((state) => state.apiModel)
  const [baseUrl, setBaseUrl] = useState(apiBaseUrl ?? '')
  const [model, setModel] = useState(apiModel ?? '')
  return (
    <>
      <div className={styles.cell}>
        <div className={styles.apiKey}>
          <div className={styles.label}>{t('apiBaseUrlLabel')}</div>
          <div className={styles.apiKeyInput}>
            <input
              type="text"
              inputMode="url"
              placeholder={t('apiBaseUrlPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              onBlur={() => setApiBaseUrl(baseUrl)}
            />
          </div>
          <div className={styles.description}>{t('apiBaseUrlHint')}</div>
        </div>
      </div>
      <ApiKeyField editor={editor} />
      <div className={styles.cell}>
        <div className={styles.apiKey}>
          <div className={styles.label}>{t('apiModelLabel')}</div>
          <div className={styles.apiKeyInput}>
            <input
              type="text"
              autoCapitalize="off"
              placeholder={t('apiModelPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              value={model}
              onChange={(event) => setModel(event.target.value)}
              onBlur={() => setApiModel(model)}
            />
          </div>
          <div className={styles.description}>{t('apiModelHint')}</div>
        </div>
      </div>
    </>
  )
}

/**
 * 字号：滑块一拖，全局正文的 --fs-scale 立刻跟着变，上方预览区就是真实效果。
 * 「跟随系统」读安卓系统字号比例（原生通过 window.AndroidInsets.fontScale 交过来）。
 */
const FontScaleSetting = () => {
  const t = useTranslate()
  const fontScale = useSettings((state) => state.fontScale)
  const fontWeight = useSettings((state) => state.fontWeight)
  const followSystem = fontScale === 'system'
  const value = resolveFontScale(fontScale)
  return (
    <div className={styles.fontScale}>
      <div className={styles.fontScaleHead}>
        <span className={styles.fontScaleTitle}>{t('settingsFontSize')}</span>
        <span className={styles.fontScaleValue}>{Math.round(value * 100)}%</span>
      </div>
      <div className={styles.fontScalePreview}>
        <div className={styles.fontScalePreviewTitle}>{t('settingsFontSizePreviewTitle')}</div>
        <div className={styles.fontScalePreviewBody}>{t('settingsFontSizePreviewBody')}</div>
      </div>
      <div className={clsx(styles.fontScaleSliderRow, followSystem && styles.fontScaleDisabled)}>
        <span className={styles.fontScaleMark} aria-hidden="true">
          A
        </span>
        <input
          className={styles.fontScaleSlider}
          type="range"
          min={FONT_SCALE_MIN}
          max={FONT_SCALE_MAX}
          step={FONT_SCALE_STEP}
          value={value}
          disabled={followSystem}
          aria-label={t('settingsFontSize')}
          onChange={(event) => setFontScale(Number(event.target.value))}
        />
        <span className={clsx(styles.fontScaleMark, styles.fontScaleMarkLarge)} aria-hidden="true">
          A
        </span>
      </div>
      <div className={styles.fontScaleHead}>
        <span className={styles.fontScaleTitle}>{t('settingsFontWeight')}</span>
      </div>
      <div className={styles.fontScaleSliderRow}>
        <span className={styles.fontScaleMark} aria-hidden="true">
          {t('settingsFontWeightThin')}
        </span>
        <input
          className={styles.fontScaleSlider}
          type="range"
          min={FONT_WEIGHT_MIN}
          max={FONT_WEIGHT_MAX}
          step={FONT_WEIGHT_STEP}
          value={fontWeight}
          aria-label={t('settingsFontWeight')}
          onChange={(event) => setFontWeight(Number(event.target.value))}
        />
        <span className={clsx(styles.fontScaleMark, styles.fontScaleMarkLarge)} aria-hidden="true">
          {t('settingsFontWeightBold')}
        </span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={followSystem}
        className={styles.fontScaleFollow}
        onClick={() => setFontScale(followSystem ? 1 : 'system')}
      >
        {t('settingsFontSizeFollowSystem')}
        <span className={clsx(styles.switch, followSystem && styles.switchOn)} aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 导出失败附带原因：预期的错误用对应文案作原因，其他错误用错误信息。 */
const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

const SettingCell = ({
  label,
  description,
  status,
  action,
  className,
}: {
  label: string
  description?: string
  status: Status
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        {status || description ? (
          <div className={clsx(styles.description, status?.error && styles.error)}>
            {status
              ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
              : description}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** 选文件后先提示覆盖；确认后才检查文件并执行导入，任何错误都提示导入失败。 */
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const importing = useRef(false)

  const confirm = async () => {
    if (!file || importing.current) {
      return
    }
    importing.current = true
    setBusy(true)
    setStatus(null)
    // 进度写进全局 store：确认弹窗和主界面状态条都读它
    setImportProgress({
      stage: 'verify',
      processed: 0,
      total: 0,
      sessions: 0,
      downloadPercent: null,
    })
    try {
      const count = await importHistory(file, (processed, total, sessions) => {
        // 第一次回调说明格式校验已过，进入真正写入阶段
        setImportProgress({ stage: 'import', processed, total, sessions })
      })
      const message: Status = {
        key: count === 1 ? 'historyImportedOne' : 'historyImported',
        params: { count },
      }
      setStatus(message)
      showToast(message as TranslationMessage)
      setImportProgress({ stage: 'done' })
    } catch {
      setStatus({ key: 'historyImportFailed', error: true })
      setImportProgress({ stage: 'failed' })
    } finally {
      importing.current = false
      setBusy(false)
      // 结束后才关闭确认弹窗，导入期间让它显示进度
      setFile(null)
      window.setTimeout(() => {
        if (!importing.current) {
          resetImportProgress()
        }
      }, 4000)
    }
  }

  return { file, busy, status, select: setFile, cancel: () => setFile(null), confirm }
}

/** 把下载/校验阶段的错误翻译成文案 key */
const linkErrorKey = (error: unknown): { key: TranslationKey; params?: Record<string, string> } => {
  if (error instanceof DownloadError) {
    switch (error.reason) {
      case 'httpStatus':
        return { key: 'historyImportLinkHttp', params: { code: error.detail ?? '?' } }
      case 'expired':
        return { key: 'historyImportLinkExpired', params: { code: error.detail ?? '403' } }
      case 'network':
        return { key: 'historyImportLinkNetwork' }
      case 'notArchive':
        return { key: 'historyImportLinkNotZip' }
      case 'tooLarge':
        return { key: 'historyImportLinkTooLarge' }
      case 'unsupported':
        return { key: 'historyImportLinkUnsupported' }
      default:
        return { key: 'historyImportLinkInvalid' }
    }
  }
  return { key: 'historyImportLinkInvalid' }
}

/** 从官方下载链接导入：下载完成交给 useHistoryImport 走同一套确认与导入流程 */
const useLinkImport = (onFile: (file: File) => void) => {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{
    key: TranslationKey
    params?: Record<string, string>
  } | null>(null)

  const start = async () => {
    if (busy || !url.trim()) {
      return
    }
    setBusy(true)
    setError(null)
    setImportProgress({
      stage: 'download',
      downloadPercent: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      processed: 0,
      total: 0,
      sessions: 0,
    })
    try {
      const file = await downloadArchive(url, (percent, received, totalBytes) => {
        setImportProgress({
          downloadPercent: percent,
          downloadedBytes: received,
          totalBytes: totalBytes ?? 0,
        })
      })
      // 下载完先收起状态条：接下来是覆盖确认，等用户点了才真正写入
      resetImportProgress()
      onFile(file)
      setOpen(false)
      setUrl('')
    } catch (failure) {
      resetImportProgress()
      setError(linkErrorKey(failure))
    } finally {
      setBusy(false)
    }
  }

  return {
    open,
    url,
    busy,
    error,
    setUrl,
    openDialog: () => {
      setError(null)
      setOpen(true)
    },
    closeDialog: () => {
      setOpen(false)
    },
    start,
  }
}

/** 导入 = 覆盖：用选中文件替换本地全部会话与附件。 */
const ImportHistory = ({
  historyImport,
  linkImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  linkImport: ReturnType<typeof useLinkImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <SettingCell
      label={t('historyImport')}
      description={t('historyImportDescription')}
      status={historyImport.status}
      action={
        <div className={styles.importActions}>
          <Button
            variant="outlined"
            size="m"
            className={styles.cellButton}
            disabled={disabled}
            onClick={linkImport.openDialog}
          >
            {t('historyImportFromLink')}
          </Button>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                historyImport.select(file)
              }
            }}
          />
        </div>
      }
    />
  )
}

/** 将全部会话及图片导出为 ZIP 文件并下载 */
const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const onExport = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const { name, blob } = await exportHistory()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCell
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || empty}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}

/** 导出运行日志：最近 24 小时的 console、网络请求与异常，用于排查问题 */
const ExportLogs = () => {
  const t = useTranslate()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const onExport = async () => {
    setBusy(true)
    setStatus(null)
    try {
      await exportLogs()
      setStatus({ key: 'logsExported' })
    } catch (error) {
      setStatus(errorStatus('logsExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCell
      label={t('exportLogsLabel')}
      description={t('logsExportDescription')}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={busy}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportLogsAction')}
        </Button>
      }
    />
  )
}

/** 项目仓库与发布信息：检查更新读取 GitHub 最新 Release 正文中对应 APK 行的版本号 */
const REPO_URL = 'https://github.com/mist-rill/DeepSeek-Chat'
const AUTHOR_URL = 'https://github.com/mist-rill'
const THIRD_PARTY_URL = `${REPO_URL}/blob/main/THIRD-PARTY-NOTICES.md`
const LATEST_RELEASE_URL = 'https://api.github.com/repos/mist-rill/DeepSeek-Chat/releases/latest'

/** 当前构建对应的 Release APK 资产前缀：资产名带版本号（如 DeepSeek-Chat-v1.22.apk），按前缀匹配 */
const APK_BY_PACKAGE: Record<string, string> = {
  'com.deepseek.chatdemo': 'DeepSeek-Chat-',
  'com.deepseek.chatdemo.custom': 'DeepSeek-Chat-CustomApi-',
  'com.deepseek.chatcute': 'DeepSeek-Cute-',
}

/** 原生端同窗口跳外部链接会被 Capacitor 拦截并交给系统浏览器打开；网页端开新窗口 */
const openExternal = (url: string) => {
  if (Capacitor.isNativePlatform()) {
    window.location.href = url
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'latest' }
  | { kind: 'available'; version: string; url: string }
  | { kind: 'failed' }

/** 用 Release 正文表格里「| APK文件名 | vX.Y (code N) |」的 code 与本地 versionCode 比较 */
const checkForUpdate = async (apkPrefix: string, localCode: number): Promise<UpdateStatus> => {
  const response = await fetch(LATEST_RELEASE_URL, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) {
    return { kind: 'failed' }
  }
  const release = (await response.json()) as {
    body?: string
    assets?: { name: string; browser_download_url: string }[]
  }
  const asset = release.assets?.find((item) => {
    if (!item.name.endsWith('.apk') || !item.name.startsWith(apkPrefix)) {
      return false
    }
    // 前缀后必须直接是版本号，避免 DeepSeek-Chat- 误匹配 DeepSeek-Chat-CustomApi-
    return /^v[\d.]+\.apk$/.test(item.name.slice(apkPrefix.length))
  })
  const row = (release.body ?? '')
    .split('\n')
    .find((line) => asset && line.includes(asset.name))
  const match = row?.match(/\|\s*v(\d+(?:\.\d+)*)\s*\(code (\d+)\)/)
  if (!asset || !match) {
    return { kind: 'failed' }
  }
  const [, version, code] = match
  return Number(code) > localCode
    ? { kind: 'available', version, url: asset.browser_download_url }
    : { kind: 'latest' }
}

/** 「关于」页：版本与检查更新、项目仓库、作者、开源协议声明 */
const AboutSetting = () => {
  const t = useTranslate()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [status, setStatus] = useState<UpdateStatus>({ kind: 'idle' })

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return
    }
    void App.getInfo().then(setInfo)
  }, [])

  const apkPrefix = info ? APK_BY_PACKAGE[info.id] : undefined
  const checking = status.kind === 'checking'
  const available = status.kind === 'available'

  const onCheck = async () => {
    if (!info || !apkPrefix || checking) {
      return
    }
    setStatus({ kind: 'checking' })
    try {
      setStatus(await checkForUpdate(apkPrefix, Number(info.build)))
    } catch {
      setStatus({ kind: 'failed' })
    }
  }

  const resultText =
    status.kind === 'checking'
      ? t('settingsAboutChecking')
      : status.kind === 'latest'
        ? t('settingsAboutUpToDate')
        : status.kind === 'failed'
          ? t('settingsAboutCheckFailed')
          : status.kind === 'available'
            ? t('settingsAboutNewVersion', { version: status.version })
            : undefined

  return (
    <>
      <SettingCell
        label={t('settingsAboutCheckUpdate')}
        description={
          info ? t('settingsVersion') + ` v${info.version} (${info.build})` : undefined
        }
        status={
          resultText
            ? {
                key: 'settingsAboutCheckResult',
                params: { message: resultText },
                error: status.kind === 'failed',
              }
            : null
        }
        action={
          <Button
            variant={available ? 'primary' : 'outlined'}
            size="m"
            className={styles.cellButton}
            disabled={checking || (!available && !apkPrefix)}
            onClick={() =>
              available ? openExternal(status.url) : void onCheck()
            }
          >
            {available ? t('settingsAboutDownload') : t('settingsAboutCheckUpdate')}
          </Button>
        }
      />
      <SettingCell
        label={t('settingsAboutRepo')}
        status={null}
        action={
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            onClick={() => openExternal(REPO_URL)}
          >
            <IconRightUpOutline14 />
            {t('settingsAboutOpen')}
          </Button>
        }
      />
      <SettingCell
        label={t('settingsAboutAuthor')}
        description="MistRill"
        status={null}
        action={
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            onClick={() => openExternal(AUTHOR_URL)}
          >
            <IconRightUpOutline14 />
            {t('settingsAboutOpen')}
          </Button>
        }
      />
      <SettingCell
        label={t('settingsAboutLicense')}
        description={t('settingsAboutLicenseDescription')}
        status={null}
        action={
          <Button
            variant="outlined"
            size="m"
            className={styles.cellButton}
            onClick={() => openExternal(THIRD_PARTY_URL)}
          >
            {t('settingsAboutThirdParty')}
          </Button>
        }
      />
    </>
  )
}
