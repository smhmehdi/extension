import React, { ReactElement, useEffect, useState } from "react"
import { useDispatch, useSelector } from "react-redux"
import { useTranslation } from "react-i18next"
import {
  setNewDefaultWalletValue,
  selectDefaultWallet,
  selectHideDust,
  toggleHideDust,
  selectShowTestNetworks,
  toggleTestNetworks,
  toggleHideBanners,
  selectHideBanners,
} from "@tallyho/tally-background/redux-slices/ui"
import { FeatureFlags, isEnabled } from "@tallyho/tally-background/features"
import { useHistory } from "react-router-dom"
import { selectMainCurrencySign } from "@tallyho/tally-background/redux-slices/selectors"
import SharedButton from "../components/Shared/SharedButton"
import SharedToggleButton from "../components/Shared/SharedToggleButton"
import SharedSelect from "../components/Shared/SharedSelect"
import { getLanguageIndex, getAvalableLanguages } from "../_locales"
import { getLanguage, setLanguage } from "../_locales/i18n"
import SettingButton from "./Settings/SettingButton"
import { useBackgroundSelector } from "../hooks"

const NUMBER_OF_CLICKS_FOR_DEV_PANEL = 15

function VersionLabel(): ReactElement {
  const { t } = useTranslation()
  const history = useHistory()
  const [clickCounter, setClickCounter] = useState(0)
  const [isHover, setIsHover] = useState(false)

  useEffect(() => {
    if (
      isEnabled(FeatureFlags.SWITCH_RUNTIME_FLAGS) &&
      clickCounter === NUMBER_OF_CLICKS_FOR_DEV_PANEL &&
      isHover
    ) {
      setIsHover(false)
      setClickCounter(0)
      history.push("/dev")
    }
  }, [clickCounter, history, isHover])

  return (
    <div className="version">
      <button
        type="button"
        onMouseEnter={() => setIsHover(true)}
        onMouseLeave={() => setIsHover(false)}
        onClick={() => setClickCounter((prevState) => prevState + 1)}
      >
        {t("settings.versionLabel", {
          version: process.env.VERSION ?? t("settings.unknownVersionOrCommit"),
        })}
        {process.env.COMMIT_SHA?.slice(0, 7) ??
          t("settings.unknownVersionOrCommit")}
      </button>
      <style jsx>
        {`
          .version {
            margin: 16px 0;
            color: var(--green-40);
            font-size: 16px;
            font-weight: 500;
            margin: 0 auto;
            padding: 16px 0px;
          }
        `}
      </style>
    </div>
  )
}

function SettingRow(props: {
  title: string
  component: () => ReactElement
}): ReactElement {
  const { title, component } = props

  return (
    <li>
      <div className="left">{title}</div>
      <div className="right">{component()}</div>
      <style jsx>
        {`
          li {
            height: 50px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .left {
            color: var(--green-20);
            font-size: 18px;
            font-weight: 600;
            line-height: 24px;
          }
        `}
      </style>
    </li>
  )
}

export default function Settings(): ReactElement {
  const { t } = useTranslation()
  const dispatch = useDispatch()
  const hideDust = useSelector(selectHideDust)
  const hideBanners = useSelector(selectHideBanners)
  const defaultWallet = useSelector(selectDefaultWallet)
  const showTestNetworks = useSelector(selectShowTestNetworks)
  const mainCurrencySign = useBackgroundSelector(selectMainCurrencySign)

  const toggleHideDustAssets = (toggleValue: boolean) => {
    dispatch(toggleHideDust(toggleValue))
  }
  const toggleDefaultWallet = (defaultWalletValue: boolean) => {
    dispatch(setNewDefaultWalletValue(defaultWalletValue))
  }

  const toggleShowTestNetworks = (defaultWalletValue: boolean) => {
    dispatch(toggleTestNetworks(defaultWalletValue))
  }

  const toggleHideNotificationBanners = (toggleValue: boolean) => {
    dispatch(toggleHideBanners(!toggleValue))
  }

  const hideSmallAssetBalance = {
    title: t("settings.hideSmallAssetBalance", {
      amount: 2,
      sign: mainCurrencySign,
    }),
    component: () => (
      <SharedToggleButton
        onChange={(toggleValue) => toggleHideDustAssets(toggleValue)}
        value={hideDust}
      />
    ),
  }

  const setAsDefault = {
    title: t("settings.setAsDefault"),
    component: () => (
      <SharedToggleButton
        onChange={(toggleValue) => toggleDefaultWallet(toggleValue)}
        value={defaultWallet}
      />
    ),
  }

  const enableTestNetworks = {
    title: t("settings.enableTestNetworks"),
    component: () => (
      <SharedToggleButton
        onChange={(toggleValue) => toggleShowTestNetworks(toggleValue)}
        value={showTestNetworks}
      />
    ),
  }

  const langOptions = getAvalableLanguages()
  const langIdx = getLanguageIndex(getLanguage())
  const languages = {
    title: t("settings.language"),
    component: () => (
      <SharedSelect
        width={194}
        options={langOptions}
        onChange={setLanguage}
        defaultIndex={langIdx}
      />
    ),
  }

  const bugReport = {
    title: "",
    component: () => (
      <SettingButton
        link="/settings/export-logs"
        label={t("settings.bugReport")}
        ariaLabel={t("settings.exportLogs.ariaLabel")}
      />
    ),
  }

  const dAppsSettings = {
    title: "",
    component: () => (
      <SettingButton
        link="/settings/connected-websites"
        label={t("settings.connectedWebsites")}
        ariaLabel={t("settings.connectedWebsitesSettings.ariaLabel")}
      />
    ),
  }

  const analytics = {
    title: "",
    component: () => (
      <SettingButton
        link="/settings/analytics"
        label={t("settings.analytics")}
        ariaLabel={t("settings.analyticsSetUp.ariaLabel")}
      />
    ),
  }

  const notificationBanner = {
    title: t("settings.showBanners"),
    component: () => (
      <SharedToggleButton
        onChange={(toggleValue) => toggleHideNotificationBanners(toggleValue)}
        value={!hideBanners}
      />
    ),
  }

  const generalList = [
    setAsDefault,
    hideSmallAssetBalance,
    ...(isEnabled(FeatureFlags.SUPPORT_MULTIPLE_LANGUAGES) ? [languages] : []),
    enableTestNetworks,
    dAppsSettings,
    bugReport,
    ...(isEnabled(FeatureFlags.ENABLE_ANALYTICS_DEFAULT_ON) ? [analytics] : []),
    ...(isEnabled(FeatureFlags.SUPPORT_ACHIEVEMENTS_BANNER)
      ? [notificationBanner]
      : []),
  ]

  const settings = {
    general: generalList,
  }

  return (
    <>
      <section className="standard_width_padded">
        <h1>{t("settings.mainMenu")}</h1>
        <ul>
          {settings.general.map((setting) => (
            <SettingRow
              key={setting.title}
              title={setting.title}
              component={setting.component}
            />
          ))}
        </ul>
        <div className="community_cta_wrap">
          <h2>{t("settings.joinTitle")}</h2>
          <p>{t("settings.joinDesc")}</p>
          <SharedButton
            type="primary"
            size="large"
            iconMedium="discord"
            iconPosition="left"
            onClick={() => {
              window.open(`https://chat.tally.cash/`, "_blank")?.focus()
            }}
          >
            {t("settings.joinBtn")}
          </SharedButton>
        </div>
        <VersionLabel />
      </section>
      <style jsx>
        {`
          section {
            display: flex;
            flex-flow: column;
            height: 544px;
            background-color: var(--hunter-green);
          }
          .community_cta_wrap {
            width: 100vw;
            margin-top: 20px;
            margin-left: -21px;
            background-color: var(--green-95);
            text-align: center;
            padding: 24px 0px;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            align-items: center;
          }
          h1 {
            color: #fff;
            font-size: 22px;
            font-weight: 500;
            line-height: 32px;
            margin-bottom: 5px;
          }
          h2 {
            font-weight: 500;
            font-size: 22px;
            padding: 0px;
            margin: 0px 0px -1px 0px;
          }
          p {
            color: var(--green-20);
            text-align: center;
            font-size: 16px;
            margin-top: 6px;
            margin-bottom: 24px;
          }
          span {
            color: var(--green-40);
            font-size: 16px;
            font-weight: 400;
            line-height: 24px;
          }
          .mega_discord_chat_bubble_button {
            background: url("./images/tally_ho_chat_bubble@2x.png");
            background-size: cover;
            width: 266px;
            height: 120px;
            margin-top: 20px;
          }
          .mega_discord_chat_bubble_button:hover {
            opacity: 0.8;
          }
        `}
      </style>
    </>
  )
}
