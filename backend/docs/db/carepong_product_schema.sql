--
-- PostgreSQL database dump
--

\restrict wkHVNuJ8vhQcQ09UwRAocLAM1EDI0NNaSx8bbRAPbfupNB1sQ84yUOZqTxh4lnh

-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: hff_product; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hff_product (
    hff_product_id bigint NOT NULL,
    prdlst_report_no character varying(50) NOT NULL,
    product_name character varying(300) NOT NULL,
    manufacturer_name character varying(300),
    function_text text,
    intake_method text,
    caution_text text,
    raw_material_text text,
    source_updated_at timestamp without time zone,
    synced_at timestamp without time zone NOT NULL
);


--
-- Name: hff_product_hff_product_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.hff_product_hff_product_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: hff_product_hff_product_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.hff_product_hff_product_id_seq OWNED BY public.hff_product.hff_product_id;


--
-- Name: med_patient_info; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.med_patient_info (
    med_product_id bigint NOT NULL,
    efficacy_text text,
    usage_text text,
    warning_text text,
    interaction_text text,
    side_effect_text text,
    storage_text text,
    source_updated_at timestamp without time zone
);


--
-- Name: med_product; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.med_product (
    med_product_id bigint NOT NULL,
    item_seq character varying(30) NOT NULL,
    product_name character varying(300) NOT NULL,
    manufacturer_name character varying(300),
    etc_otc_code character varying(50),
    dosage_form character varying(100),
    route character varying(100),
    permit_date date,
    permit_status character varying(30),
    source_updated_at timestamp without time zone,
    synced_at timestamp without time zone NOT NULL
);


--
-- Name: med_product_med_product_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.med_product_med_product_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: med_product_med_product_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.med_product_med_product_id_seq OWNED BY public.med_product.med_product_id;


--
-- Name: hff_product hff_product_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hff_product ALTER COLUMN hff_product_id SET DEFAULT nextval('public.hff_product_hff_product_id_seq'::regclass);


--
-- Name: med_product med_product_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.med_product ALTER COLUMN med_product_id SET DEFAULT nextval('public.med_product_med_product_id_seq'::regclass);


--
-- Name: hff_product hff_product_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hff_product
    ADD CONSTRAINT hff_product_pkey PRIMARY KEY (hff_product_id);


--
-- Name: hff_product hff_product_prdlst_report_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hff_product
    ADD CONSTRAINT hff_product_prdlst_report_no_key UNIQUE (prdlst_report_no);


--
-- Name: med_patient_info med_patient_info_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.med_patient_info
    ADD CONSTRAINT med_patient_info_pkey PRIMARY KEY (med_product_id);


--
-- Name: med_product med_product_item_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.med_product
    ADD CONSTRAINT med_product_item_seq_key UNIQUE (item_seq);


--
-- Name: med_product med_product_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.med_product
    ADD CONSTRAINT med_product_pkey PRIMARY KEY (med_product_id);


--
-- Name: ix_hff_product_product_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_hff_product_product_name ON public.hff_product USING btree (product_name);


--
-- Name: ix_med_product_product_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_med_product_product_name ON public.med_product USING btree (product_name);


--
-- Name: med_patient_info med_patient_info_med_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.med_patient_info
    ADD CONSTRAINT med_patient_info_med_product_id_fkey FOREIGN KEY (med_product_id) REFERENCES public.med_product(med_product_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict wkHVNuJ8vhQcQ09UwRAocLAM1EDI0NNaSx8bbRAPbfupNB1sQ84yUOZqTxh4lnh

