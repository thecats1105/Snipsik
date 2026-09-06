import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { CustomId } from "@/types/bot";
import type { SinkLink } from "@/types/sink";

export function createLinkModal(): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(CustomId.MODAL_CREATE_LINK)
    .setTitle("새 단축 링크 생성");

  const urlInput = new TextInputBuilder()
    .setCustomId("url")
    .setLabel("타겟 URL (필수)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("https://example.com/very-long-url")
    .setMaxLength(2048)
    .setRequired(true);

  const expirationInput = new TextInputBuilder()
    .setCustomId("expiration")
    .setLabel("만료 기간 (선택, 예: 10m, 1h, 7d)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("예: 1h, 24h, 7d (비워두면 무제한)")
    .setRequired(false);

  const passwordInput = new TextInputBuilder()
    .setCustomId("password")
    .setLabel("비밀번호 보호 (선택)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("비밀번호 설정 시 접속 시 요구됨")
    .setRequired(false);

  const tagInput = new TextInputBuilder()
    .setCustomId("tag")
    .setLabel("태그 (선택)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("예: github, docs, event")
    .setRequired(false);

  const titleInput = new TextInputBuilder()
    .setCustomId("title")
    .setLabel("링크 제목 (선택)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("링크에 표시할 제목")
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(urlInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(expirationInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(passwordInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(tagInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
  );

  return modal;
}

export function createEditLinkModal(link: SinkLink): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`${CustomId.MODAL_EDIT_LINK}:${link.slug}`)
    .setTitle(`링크 수정 (/${link.slug})`.substring(0, 45));

  const urlInput = new TextInputBuilder()
    .setCustomId("url")
    .setLabel("타겟 URL (필수)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("https://example.com")
    .setMaxLength(2048)
    .setRequired(true);
  if (link.url) {
    urlInput.setValue(link.url);
  }

  const titleInput = new TextInputBuilder()
    .setCustomId("title")
    .setLabel("링크 제목 (선택)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("링크 제목")
    .setRequired(false);
  if (link.title) {
    titleInput.setValue(link.title);
  }

  const tagInput = new TextInputBuilder()
    .setCustomId("tag")
    .setLabel("태그 (선택)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("예: github, docs, dev")
    .setRequired(false);
  if (link.tag) {
    tagInput.setValue(link.tag);
  }

  const descriptionInput = new TextInputBuilder()
    .setCustomId("description")
    .setLabel("설명 (선택)")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("링크에 대한 부가 설명")
    .setRequired(false);
  if (link.description) {
    descriptionInput.setValue(link.description);
  }

  const passwordInput = new TextInputBuilder()
    .setCustomId("password")
    .setLabel("비밀번호 (비워두면 유지 / 해제는 'none')")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(
      "새 비밀번호 입력 / 해제 시 'none' 입력 / 비워두면 기존 유지",
    )
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(urlInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(tagInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(passwordInput),
  );

  return modal;
}

/**
 * Creates a modal for setting user minimum URL length threshold.
 *
 * @param currentVal - Current user threshold (number or null if inherited).
 * @returns Configured ModalBuilder instance.
 */
export function createMinLengthConfigModal(
  currentVal: number | null,
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(CustomId.MODAL_CONFIG_MIN_LENGTH)
    .setTitle("최소 URL 길이 설정");

  const lengthInput = new TextInputBuilder()
    .setCustomId("min_length")
    .setLabel("최소 URL 길이 (-1: 상속, 0: 전체, 1~2048: 길이)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("예: 70 (-1은 기본값 상속, 0은 전체)")
    .setRequired(true)
    .setMaxLength(5);

  if (currentVal !== null && currentVal !== undefined) {
    lengthInput.setValue(String(currentVal));
  }

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(lengthInput),
  );

  return modal;
}
